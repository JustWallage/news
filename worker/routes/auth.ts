import { generateCodeVerifier, generateState } from "arctic";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  authConfigSchema,
  emailLoginRequestResultSchema,
  emailLoginRequestSchema,
  emailLoginVerifySchema,
  okSchema,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { makeEmailSender } from "../lib/email";
import { normalizeEmail, requestCode, verifyCode } from "../lib/email-login";
import { makeGoogleAuth } from "../lib/oauth";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../lib/session";
import { verifyTurnstile } from "../lib/turnstile";

const STATE_COOKIE = "__Host-oauth_state";
const VERIFIER_COOKIE = "__Host-oauth_verifier";
const OAUTH_FLOW_TTL_S = 600;

const flowCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

// Session cookie options shared by every sign-in path. Secure + Path=/ + no
// Domain are mandatory for the `__Host-` prefixed cookie name (see session.ts).
const sessionCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
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
  deleteCookie(c, STATE_COOKIE, { path: "/", secure: true });
  deleteCookie(c, VERIFIER_COOKIE, { path: "/", secure: true });
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
  setCookie(c, SESSION_COOKIE, token, sessionCookie);
  return c.redirect("/");
});

// Email sign-in, step 1: mint a one-time code and email it. Bot-gated by the same
// Turnstile seam as Google login. Fails closed (503) when the email sender is
// unconfigured in production. The code is returned in the response ONLY in
// local/e2e (devCode), where the email seam delivers nothing.
authRoutes.post("/email/request", async (c) => {
  const parsed = emailLoginRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  if (
    !(await verifyTurnstile(c.env, parsed.data.turnstileToken ?? undefined))
  ) {
    return c.json({ error: "Turnstile verification failed" }, 403);
  }
  const sender = makeEmailSender(c.env);
  if (sender === null) {
    return c.json({ error: "email not configured" }, 503);
  }
  const email = normalizeEmail(parsed.data.email);
  const result = await requestCode(getDb(c.env), email, new Date());
  if ("retryAfterMs" in result) {
    return c.json({ error: "Too many requests" }, 429, {
      "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
    });
  }
  const link = `${c.env.APP_URL}/?login_email=${encodeURIComponent(email)}&login_code=${result.code}`;
  await sender.sendLoginCode(email, result.code, link);
  const isFakeSeam =
    c.env.ENVIRONMENT === "local" || c.env.ENVIRONMENT === "e2e";
  return c.json(
    emailLoginRequestResultSchema.parse({
      ok: true,
      ...(isFakeSeam ? { devCode: result.code } : {}),
    }),
  );
});

// Email sign-in, step 2: verify the code and mint a session. A single 400 covers
// every failure (wrong, expired, too many attempts) so nothing about the code's
// state leaks.
authRoutes.post("/email/verify", async (c) => {
  const parsed = emailLoginVerifySchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const email = normalizeEmail(parsed.data.email);
  const ok = await verifyCode(
    getDb(c.env),
    email,
    parsed.data.code,
    new Date(),
  );
  if (!ok) {
    return c.json({ error: "Invalid or expired code" }, 400);
  }
  const { token } = await createSession(getDb(c.env), email, new Date());
  setCookie(c, SESSION_COOKIE, token, sessionCookie);
  return c.json(okSchema.parse({ ok: true }));
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token !== undefined) {
    await deleteSession(getDb(c.env), token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.json(okSchema.parse({ ok: true }));
});
