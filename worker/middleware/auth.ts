import { createMiddleware } from "hono/factory";

/**
 * THE ONLY place identity is resolved. Routes must read identity exclusively
 * via `c.get("userEmail")` and never touch auth headers themselves.
 *
 * ENVIRONMENT switches the identity source; any unknown value is treated as
 * production (fail closed):
 * - production: Cloudflare Access header, re-checked against ALLOWED_EMAILS.
 * - e2e:        X-Test-User-Email, gated by a timing-safe X-Test-Auth check
 *               against the TEST_AUTH_TOKEN secret.
 * - local:      DEV_USER_EMAIL from .dev.vars.
 */
export interface AuthBindings {
  ENVIRONMENT: string;
  ALLOWED_EMAILS: string;
  DEV_USER_EMAIL?: string;
  TEST_AUTH_TOKEN?: string;
}

interface AuthEnv {
  Bindings: AuthBindings;
  Variables: { userEmail: string };
}

const encoder = new TextEncoder();

// Compares SHA-256 digests so inputs of different lengths are safe and the
// comparison itself is constant-time.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const environment = c.env.ENVIRONMENT;

  if (environment === "local") {
    const email = c.env.DEV_USER_EMAIL;
    if (email === undefined || email === "") {
      return c.json({ error: "DEV_USER_EMAIL is not configured" }, 500);
    }
    c.set("userEmail", email);
    return next();
  }

  if (environment === "e2e") {
    const expectedToken = c.env.TEST_AUTH_TOKEN;
    const givenToken = c.req.header("X-Test-Auth");
    const email = c.req.header("X-Test-User-Email");
    if (
      expectedToken === undefined ||
      expectedToken === "" ||
      givenToken === undefined ||
      email === undefined ||
      email === "" ||
      !(await timingSafeEqual(expectedToken, givenToken))
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("userEmail", email);
    return next();
  }

  // production — and any unrecognized ENVIRONMENT (fail closed)
  const email = c.req.header("Cf-Access-Authenticated-User-Email");
  if (email === undefined || email === "") {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const allowed = c.env.ALLOWED_EMAILS.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (!allowed.includes(email)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  c.set("userEmail", email);
  return next();
});
