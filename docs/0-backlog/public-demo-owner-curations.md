# Public demo: show the owner's own curations on the homepage

A Google sign-in wall before anyone can see _anything_ is the biggest bounce risk
for a public/Show HN launch — people won't authenticate to a random site just to
find out what it does. Fix it by showing a real, live example without sign-in:
the owner's own curated feed.

## Approach (recommended)

Keep the existing explanatory homepage — it's good context — and add a section at
the **top** of it:

> **The owner's current curations** — _last refreshed {relative time}_

…rendering the live feed for the owner account (the production owner email, NOT a
hardcoded personal address — see the test-email cleanup; source no longer carries
a real personal email). Below it, the rest of the current homepage continues:
the explanation, how it works, and the login buttons. Make it unmistakable that
these are _the owner's personal_ curations for _their_ interests, with a clear
line like "These are my picks — sign in to get your own feed tuned to yours."

Rationale for keeping the homepage rather than replacing it with the feed: the
explanation is what converts a confused visitor, and the demo section is what
stops them bouncing before they read it. Top-of-page demo + explanation + CTA
gets both.

## Open question

Confirm the exact layout: demo-strip-on-top-of-homepage (recommended) vs. a
split/replace. Decide whether the demo feed is read-only (no open-tracking, no
refresh button) for anonymous visitors.

## Implementation notes / cautions

- **Read-only & cache-friendly**: serve the owner feed from stored `curations`
  for the owner — do NOT let an anonymous homepage hit trigger a Workers AI
  digest run (that would let unauthenticated traffic burn the Neuron budget).
  Read the latest stored feed only; the owner's own scheduled/cron + Refresh keep
  it fresh.
- **New public endpoint**: needs a route that returns the owner feed WITHOUT a
  session. It must expose only public-safe fields (title, url, score, time) and
  never anything user-private. Mind the `no-store` / per-user caching invariant in
  `worker/index.ts` — a public, cacheable response is a different cache policy
  than the authenticated API.
- **"last refreshed X"**: derive from the owner's latest `curatedAt`.
- Add e2e coverage: anonymous visitor sees the demo feed + CTA, and the demo path
  does NOT invoke the AI filter.
