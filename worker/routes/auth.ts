import { generateCodeVerifier, generateState } from "arctic";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { authConfigSchema, okSchema } from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { makeGoogleAuth } from "../lib/oauth";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../lib/session";
import { verifyTurnstile } from "../lib/turnstile";

const STATE_COOKIE = "oauth_state";
const VERIFIER_COOKIE = "oauth_verifier";
const OAUTH_FLOW_TTL_S = 600;

const flowCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

export const authRoutes = new Hono<AppEnv>();

// Public client config the sign-in screen reads to decide whether to render the
// Turnstile widget. Site keys are not secret; null when Turnstile is unconfigured.
authRoutes.get("/config", (c) => {
  const siteKey = c.env.TURNSTILE_SITE_KEY ?? "";
  return c.json(
    authConfigSchema.parse({
      turnstileSiteKey: siteKey === "" ? null : siteKey,
    }),
  );
});

authRoutes.get("/login", async (c) => {
  const auth = makeGoogleAuth(c.env, `${c.env.APP_URL}/auth/callback`);
  if (auth === null) {
    return c.json({ error: "auth not configured" }, 503);
  }
  // Turnstile bot-gate (skipped in local/e2e; no-op when unconfigured in prod).
  // The widget posts its token as `cf-turnstile-response` on the sign-in form.
  if (!(await verifyTurnstile(c.env, c.req.query("cf-turnstile-response")))) {
    return c.json({ error: "Turnstile verification failed" }, 403);
  }
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  setCookie(c, STATE_COOKIE, state, {
    ...flowCookie,
    maxAge: OAUTH_FLOW_TTL_S,
  });
  setCookie(c, VERIFIER_COOKIE, codeVerifier, {
    ...flowCookie,
    maxAge: OAUTH_FLOW_TTL_S,
  });
  return c.redirect(auth.createAuthUrl(state, codeVerifier));
});

authRoutes.get("/callback", async (c) => {
  const auth = makeGoogleAuth(c.env, `${c.env.APP_URL}/auth/callback`);
  if (auth === null) {
    return c.json({ error: "auth not configured" }, 503);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, STATE_COOKIE);
  const codeVerifier = getCookie(c, VERIFIER_COOKIE);
  deleteCookie(c, STATE_COOKIE);
  deleteCookie(c, VERIFIER_COOKIE);
  if (
    code === undefined ||
    state === undefined ||
    storedState === undefined ||
    codeVerifier === undefined ||
    state !== storedState
  ) {
    return c.json({ error: "Invalid OAuth state" }, 400);
  }

  let claims;
  try {
    claims = await auth.verifyCode(code, codeVerifier);
  } catch {
    // A bad/replayed code (or a transient Google error) lands here — surface a
    // clean 400 instead of an unhandled 500, and don't mint a session.
    return c.json({ error: "Sign-in failed, please try again" }, 400);
  }
  if (!claims.emailVerified) {
    return c.json({ error: "Email not verified with Google" }, 403);
  }

  const { token } = await createSession(getDb(c.env), claims.email, new Date());
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect("/");
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token !== undefined) {
    await deleteSession(getDb(c.env), token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json(okSchema.parse({ ok: true }));
});
