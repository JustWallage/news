import { decodeIdToken, Google } from "arctic";
import { z } from "zod";
import type { Bindings } from "../env";

interface GoogleClaims {
  email: string;
  emailVerified: boolean;
}

// The Google sign-in seam. Routes build the authorize URL and exchange the code
// through this interface so they can be unit-tested with a fake.
export interface GoogleAuth {
  createAuthUrl(state: string, codeVerifier: string): string;
  verifyCode(code: string, codeVerifier: string): Promise<GoogleClaims>;
}

const idTokenSchema = z.object({
  email: z.string(),
  email_verified: z.boolean(),
});

function makeRealGoogleAuth(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): GoogleAuth {
  const google = new Google(clientId, clientSecret, redirectUri);
  return {
    createAuthUrl: (state, codeVerifier) =>
      google
        .createAuthorizationURL(state, codeVerifier, [
          "openid",
          "profile",
          "email",
        ])
        .toString(),
    verifyCode: async (code, codeVerifier) => {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const claims = idTokenSchema.parse(decodeIdToken(tokens.idToken()));
      return { email: claims.email, emailVerified: claims.email_verified };
    },
  };
}

// Deterministic stand-in for local + e2e, where there are no Google credentials.
// The sentinel code "unverified" yields an unverified claim so the callback's
// reject path is exercisable; any other code yields a verified owner.
const fakeGoogleAuth: GoogleAuth = {
  createAuthUrl: (state) =>
    `https://accounts.google.test/authorize?state=${state}`,
  verifyCode: (code) =>
    Promise.resolve({
      email: "just@wallage.nl",
      emailVerified: code !== "unverified",
    }),
};

// Security-critical: the fake is used ONLY in local/e2e. Production (and any
// unknown ENVIRONMENT) always uses the real client and returns null — a
// fail-closed 503 at the route — when the secrets are absent, so a misconfigured
// deploy can never mint a session from the fake.
export function makeGoogleAuth(
  env: Bindings,
  redirectUri: string,
): GoogleAuth | null {
  if (env.ENVIRONMENT === "local" || env.ENVIRONMENT === "e2e") {
    return fakeGoogleAuth;
  }
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (
    clientId === undefined ||
    clientId === "" ||
    clientSecret === undefined ||
    clientSecret === ""
  ) {
    return null;
  }
  return makeRealGoogleAuth(clientId, clientSecret, redirectUri);
}
