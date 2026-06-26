import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions } from "../../db/schema";
import { app } from "../index";
import { getDb } from "../lib/db";
import { createSession, SESSION_COOKIE } from "../lib/session";

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
    const { token } = await createSession(db, "user@example.test", new Date());
    const res = await app.request(
      "/auth/logout",
      { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
