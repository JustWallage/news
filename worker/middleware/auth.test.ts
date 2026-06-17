import { Hono } from "hono";
import { describe, expect, it } from "vitest";
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

const ALLOWED = "just@wallage.nl";

describe("authMiddleware — production", () => {
  const env: AuthBindings = {
    ENVIRONMENT: "production",
    ALLOWED_EMAILS: ALLOWED,
  };

  it("accepts an allowlisted Cloudflare Access identity", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { "Cf-Access-Authenticated-User-Email": "just@wallage.nl" } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "just@wallage.nl" });
  });

  it("rejects when the Access header is missing", async () => {
    const res = await probeApp().request("/probe", {}, env);
    expect(res.status).toBe(401);
  });

  it("rejects identities not in ALLOWED_EMAILS", async () => {
    const res = await probeApp().request(
      "/probe",
      {
        headers: {
          "Cf-Access-Authenticated-User-Email": "intruder@example.com",
        },
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("ignores e2e test headers in production", async () => {
    const res = await probeApp().request(
      "/probe",
      {
        headers: {
          "X-Test-User-Email": "just@wallage.nl",
          "X-Test-Auth": "whatever",
        },
      },
      { ...env, TEST_AUTH_TOKEN: "whatever" },
    );
    expect(res.status).toBe(401);
  });
});

describe("authMiddleware — unknown environment fails closed (like production)", () => {
  const env: AuthBindings = {
    ENVIRONMENT: "weird-env",
    ALLOWED_EMAILS: ALLOWED,
  };

  it("requires the Access header", async () => {
    const res = await probeApp().request("/probe", {}, env);
    expect(res.status).toBe(401);
  });

  it("still enforces the allowlist", async () => {
    const res = await probeApp().request(
      "/probe",
      {
        headers: {
          "Cf-Access-Authenticated-User-Email": "intruder@example.com",
        },
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe("authMiddleware — e2e", () => {
  const env: AuthBindings = {
    ENVIRONMENT: "e2e",
    ALLOWED_EMAILS: ALLOWED,
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
      env,
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
      env,
    );
    expect(res.status).toBe(401);
  });

  it("does not fall back to the Access header", async () => {
    const res = await probeApp().request(
      "/probe",
      { headers: { "Cf-Access-Authenticated-User-Email": "just@wallage.nl" } },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("authMiddleware — local", () => {
  it("uses DEV_USER_EMAIL", async () => {
    const res = await probeApp().request(
      "/probe",
      {},
      {
        ENVIRONMENT: "local",
        ALLOWED_EMAILS: ALLOWED,
        DEV_USER_EMAIL: "just@wallage.nl",
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "just@wallage.nl" });
  });

  it("errors when DEV_USER_EMAIL is unset", async () => {
    const res = await probeApp().request(
      "/probe",
      {},
      { ENVIRONMENT: "local", ALLOWED_EMAILS: ALLOWED },
    );
    expect(res.status).toBe(500);
  });
});
