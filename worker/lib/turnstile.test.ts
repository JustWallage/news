import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../env";
import { verifyTurnstile } from "./turnstile";

// Build a production-like env from the pool env (which is e2e) so the gating
// branches that don't hit the network are exercisable.
function prodEnv(overrides: Partial<Bindings>): Bindings {
  return { ...env, ENVIRONMENT: "production", ...overrides };
}

describe("verifyTurnstile", () => {
  it("skips verification (true) in e2e/local", async () => {
    expect(await verifyTurnstile(env, undefined)).toBe(true);
  });

  it("is a no-op (true) in production when no secret is configured", async () => {
    expect(await verifyTurnstile(prodEnv({}), "tok")).toBe(true);
  });

  it("rejects (false) when configured but the token is missing", async () => {
    expect(
      await verifyTurnstile(
        prodEnv({ TURNSTILE_SECRET_KEY: "secret" }),
        undefined,
      ),
    ).toBe(false);
  });
});
