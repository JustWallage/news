import posthog from "posthog-js";

// Shared project key with the portfolio site (public `phc_` key, safe to ship).
// Ingestion goes through the first-party reverse proxy (worker/index.ts routes
// the e.news.justwallage.nl host to PostHog) so ad blockers don't drop events.
// Gated to the real production host only: dev is localhost and the ephemeral
// e2e worker is a *.workers.dev origin — both are PROD vite builds, so
// import.meta.env.PROD can't tell them apart. The hostname can.
const KEY = "phc_kzwmmqv6uc2PcL6L6qtjAxU3DonEfvXCzQB3HZameuRv";
const API_HOST = "https://e.news.justwallage.nl";
const PROD_HOST = "news.justwallage.nl";

export const analyticsEnabled =
  import.meta.env.PROD && window.location.hostname === PROD_HOST;

if (analyticsEnabled) {
  posthog.init(KEY, {
    api_host: API_HOST,
    ui_host: "https://eu.posthog.com",
    capture_pageview: false,
    person_profiles: "identified_only",
  });
}

export { posthog };
