import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions } from "../../db/schema";
import { getDb } from "../lib/db";
import { createSession, SESSION_COOKIE } from "../lib/session";
import { authMiddleware, type AuthBindings } from "./auth";

interface TestEnv {
  Bindings: AuthBindings;
  Variables: { userEmail: string };
}

const probeApp = () => {
  const app = new Hono<TestEnv>();
  app.use(authMiddleware);
  app.get("/probe", (c) => c.json({ email: c.get("userEmail") }));
  return app;
};

const USER = "just@wallage.nl";

beforeEach(async () => {
  await getDb(env).delete(sessions);
});

async function sessionCookie(): Promise<string> {
  const { token } = await createSession(getDb(env), USER, new Date());
  return `${SESSION_COOKIE}=${token}`;
}

describe("authMiddleware — production", () => {
  const prodEnv: AuthBindings = { ENVIRONMENT: "production", DB: env.DB };

  it("accepts a valid session cookie", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { cookie: await sessionCookie() } },
      prodEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: USER });
  });

  it("rejects when the session cookie is missing", async () => {
    const res = await probeApp().request("/probe", {}, prodEnv);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown session token", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { cookie: `${SESSION_COOKIE}=bogus` } },
      prodEnv,
    );
    expect(res.status).toBe(401);
  });

  it("ignores e2e test headers in production", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { "X-Test-User-Email": USER, "X-Test-Auth": "whatever" } },
      { ...prodEnv, TEST_AUTH_TOKEN: "whatever" },
    );
    expect(res.status).toBe(401);
  });
});

describe("authMiddleware — unknown environment fails closed (like production)", () => {
  const weirdEnv: AuthBindings = { ENVIRONMENT: "weird-env", DB: env.DB };

  it("requires a session cookie", async () => {
    const res = await probeApp().request("/probe", {}, weirdEnv);
    expect(res.status).toBe(401);
  });

  it("accepts a valid session cookie", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { cookie: await sessionCookie() } },
      weirdEnv,
    );
    expect(res.status).toBe(200);
  });
});

describe("authMiddleware — e2e", () => {
  const e2eEnv: AuthBindings = {
    ENVIRONMENT: "e2e",
    DB: env.DB,
    TEST_AUTH_TOKEN: "secret-token",
  };

  it("accepts a test identity with the correct token", async () => {
    const res = await probeApp().request(
      "/probe",
      {
        headers: {
          "X-Test-User-Email": "tester@example.com",
          "X-Test-Auth": "secret-token",
        },
      },
      e2eEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "tester@example.com" });
  });

  it("rejects a wrong token", async () => {
    const res = await probeApp().request(
      "/probe",
      {
        headers: {
          "X-Test-User-Email": "tester@example.com",
          "X-Test-Auth": "wrong",
        },
      },
      e2eEnv,
    );
    expect(res.status).toBe(401);
  });

  it("does not fall back to a session cookie", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { cookie: await sessionCookie() } },
      e2eEnv,
    );
    expect(res.status).toBe(401);
  });
});

describe("authMiddleware — local", () => {
  it("uses DEV_USER_EMAIL", async () => {
    const res = await probeApp().request(
      "/probe",
      {},
      { ENVIRONMENT: "local", DB: env.DB, DEV_USER_EMAIL: USER },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: USER });
  });

  it("errors when DEV_USER_EMAIL is unset", async () => {
    const res = await probeApp().request(
      "/probe",
      {},
      { ENVIRONMENT: "local", DB: env.DB },
    );
    expect(res.status).toBe(500);
  });
});
