import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      /**
       * Present only under vitest (injected by vitest.workers.config.ts) and
       * consumed by worker/test-setup.ts. Never set in deployed environments.
       */
      TEST_MIGRATIONS?: D1Migration[];
    }
  }
}

export {};
