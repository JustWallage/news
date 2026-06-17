import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Each test file gets fresh isolated storage; bring the D1 schema up to date.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);
