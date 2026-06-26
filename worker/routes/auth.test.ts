import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { emailLoginCodes, sessions } from "../../db/schema";
import { emailLoginRequestResultSchema } from "../../shared/api";
import { app } from "../index";
import { getDb } from "../lib/db";
import { requestCode } from "../lib/email-login";
import { createSession, SESSION_COOKIE } from "../lib/session";

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Production-mode env for asserting behavior the e2e env masks (the session
// cookie, and the fail-closed email sender). Mirrors middleware/auth.test.ts.
const prodEnv = { ...env, ENVIRONMENT: "production" };

// Turn a response's Set-Cookie headers into a Cookie request header, keeping
// only the name=value pair of each (dropping attributes like Path/Max-Age).
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function cookieValue(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.split("="))
    .find((pair) => pair?.[0] === name)?.[1];
}

beforeEach(async () => {
  await getDb(env).delete(sessions);
  await getDb(env).delete(emailLoginCodes);
});

describe("/auth/login", () => {
  it("redirects to Google and sets the state + verifier cookies", async () => {
    const res = await app.request("/auth/login", {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "accounts.google.test/authorize",
    );
    expect(cookieValue(res, "__Host-oauth_state")).toBeDefined();
    expect(cookieValue(res, "__Host-oauth_verifier")).toBeDefined();
  });
});

describe("/auth/callback", () => {
  async function login(): Promise<{ cookies: string; state: string }> {
    const res = await app.request("/auth/login", {}, env);
    const state = cookieValue(res, "__Host-oauth_state");
    if (state === undefined) {
      throw new Error("login did not set a state cookie");
    }
    return { cookies: cookieHeader(res), state };
  }

  it("creates a session and redirects home on a valid callback", async () => {
    const { cookies, state } = await login();
    const res = await app.request(
      `/auth/callback?code=ok&state=${state}`,
      { headers: { cookie: cookies } },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(cookieValue(res, SESSION_COOKIE)).toBeDefined();
    expect(await getDb(env).select().from(sessions)).toHaveLength(1);
  });

  it("rejects a mismatched state without creating a session", async () => {
    const { cookies } = await login();
    const res = await app.request(
      `/auth/callback?code=ok&state=tampered`,
      { headers: { cookie: cookies } },
      env,
    );
    expect(res.status).toBe(400);
    expect(await getDb(env).select().from(sessions)).toHaveLength(0);
  });

  it("rejects an unverified Google email", async () => {
    const { cookies, state } = await login();
    const res = await app.request(
      `/auth/callback?code=unverified&state=${state}`,
      { headers: { cookie: cookies } },
      env,
    );
    expect(res.status).toBe(403);
    expect(await getDb(env).select().from(sessions)).toHaveLength(0);
  });

  it("returns 400 (not 500) when the token exchange throws", async () => {
    const { cookies, state } = await login();
    const res = await app.request(
      `/auth/callback?code=boom&state=${state}`,
      { headers: { cookie: cookies } },
      env,
    );
    expect(res.status).toBe(400);
    expect(await getDb(env).select().from(sessions)).toHaveLength(0);
  });
});

describe("/auth/email/request", () => {
  it("issues a code and returns devCode in the e2e env", async () => {
    const res = await app.request(
      "/auth/email/request",
      jsonPost({ email: "Person@Example.com" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = emailLoginRequestResultSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    expect(typeof body.devCode).toBe("string");
    // Stored under the normalized (lowercased) email.
    const rows = await getDb(env).select().from(emailLoginCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("person@example.com");
  });

  it("throttles an immediate resend with 429", async () => {
    await app.request(
      "/auth/email/request",
      jsonPost({ email: "p@example.com" }),
      env,
    );
    const res = await app.request(
      "/auth/email/request",
      jsonPost({ email: "p@example.com" }),
      env,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("fails closed with 503 in production when email is unconfigured", async () => {
    const res = await app.request(
      "/auth/email/request",
      jsonPost({ email: "p@example.com" }),
      prodEnv,
    );
    expect(res.status).toBe(503);
  });
});

describe("/auth/email/verify", () => {
  it("mints a session and sets the cookie on a valid code (production)", async () => {
    const result = await requestCode(
      getDb(env),
      "person@example.com",
      new Date(),
    );
    if (!("code" in result)) {
      throw new Error("expected a code");
    }
    const res = await app.request(
      "/auth/email/verify",
      jsonPost({ email: "Person@Example.com", code: result.code }),
      prodEnv,
    );
    expect(res.status).toBe(200);
    expect(cookieValue(res, SESSION_COOKIE)).toBeDefined();
    const sessionRows = await getDb(env).select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.userEmail).toBe("person@example.com");
    // The code is consumed.
    expect(await getDb(env).select().from(emailLoginCodes)).toHaveLength(0);
  });

  it("rejects a wrong code with 400 and no session", async () => {
    const result = await requestCode(
      getDb(env),
      "person@example.com",
      new Date(),
    );
    if (!("code" in result)) {
      throw new Error("expected a code");
    }
    const wrong = result.code === "000000" ? "111111" : "000000";
    const res = await app.request(
      "/auth/email/verify",
      jsonPost({ email: "person@example.com", code: wrong }),
      prodEnv,
    );
    expect(res.status).toBe(400);
    expect(await getDb(env).select().from(sessions)).toHaveLength(0);
  });
});

describe("/auth/config", () => {
  it("reports no Turnstile site key when unconfigured (e2e)", async () => {
    const res = await app.request("/auth/config", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ turnstileSiteKey: null });
  });
});

describe("/auth/logout", () => {
  it("deletes the session and clears the cookie", async () => {
    const db = getDb(env);
    const { token } = await createSession(db, "just@wallage.nl", new Date());
    const res = await app.request(
      "/auth/logout",
      { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
