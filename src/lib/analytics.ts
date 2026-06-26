import posthog from "posthog-js";

// Shared project key with the portfolio site (public `phc_` key, safe to ship).
// Ingestion goes through the first-party reverse proxy (worker/index.ts routes
// the e.news.justwallage.nl host to PostHog) so ad blockers don't drop events.
// Only initialised in production builds — local dev (5173) and e2e (5174) send
// nothing, keeping the analytics project clean.
const KEY = "phc_kzwmmqv6uc2PcL6L6qtjAxU3DonEfvXCzQB3HZameuRv";
const API_HOST = "https://e.news.justwallage.nl";

export const analyticsEnabled = import.meta.env.PROD;

if (analyticsEnabled) {
  posthog.init(KEY, {
    api_host: API_HOST,
    ui_host: "https://eu.posthog.com",
    capture_pageview: false,
    person_profiles: "identified_only",
  });
}

export { posthog };
