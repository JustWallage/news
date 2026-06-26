import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { makeEmailSender } from "./email";

describe("makeEmailSender", () => {
  it("returns a no-op fake in the e2e/local env", async () => {
    const sender = makeEmailSender(env);
    expect(sender).not.toBeNull();
    // The fake never touches the EMAIL binding (absent here) and resolves.
    await expect(
      sender?.sendLoginCode("user@example.com", "123456", "https://x/"),
    ).resolves.toBeUndefined();
  });

  it("fails closed (null) in production when the EMAIL binding is absent", () => {
    expect(
      makeEmailSender({
        ...env,
        ENVIRONMENT: "production",
        EMAIL_FROM: "news@example.com",
      }),
    ).toBeNull();
  });

  it("fails closed (null) in production when EMAIL_FROM is unset", () => {
    expect(
      makeEmailSender({ ...env, ENVIRONMENT: "production", EMAIL_FROM: "" }),
    ).toBeNull();
  });
});
