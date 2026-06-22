import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { getDb } from "../lib/db";
import { lookupSession, SESSION_COOKIE } from "../lib/session";
import { timingSafeEqual } from "../lib/crypto";

/**
 * THE ONLY place identity is resolved. Routes must read identity exclusively
 * via `c.get("userEmail")` and never touch auth headers/cookies themselves.
 *
 * ENVIRONMENT switches the identity source; any unknown value is treated as
 * production (fail closed):
 * - production: the `session` cookie, resolved against the sessions table.
 * - e2e:        X-Test-User-Email, gated by a timing-safe X-Test-Auth check
 *               against the TEST_AUTH_TOKEN secret.
 * - local:      DEV_USER_EMAIL from .dev.vars.
 */
export interface AuthBindings {
  ENVIRONMENT: string;
  DB: D1Database;
  DEV_USER_EMAIL?: string;
  TEST_AUTH_TOKEN?: string;
}

interface AuthEnv {
  Bindings: AuthBindings;
  Variables: { userEmail: string };
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
  const token = getCookie(c, SESSION_COOKIE);
  if (token === undefined) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const email = await lookupSession(getDb(c.env), token, new Date());
  if (email === null) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userEmail", email);
  return next();
});
