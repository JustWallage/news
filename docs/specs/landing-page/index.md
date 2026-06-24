# Spec: Unauthenticated landing page

## Request (verbatim)

> This app is now live, but it doesn't have a homepage yet. Can you create a
> simple frontpage that simply explains the app but also looks kinda
> stylish/modern, but minimalistic and in line with the rest of the app. The
> goal isn't to be flashy and fancy, but to be clear, minimalistic, modern,
> simple, and explaining. This should obviously be an unauthenticated page.

## Context

Today an unauthenticated visitor (the `/api/health` call 401s) is shown
`SignIn` inside `src/components/AuthGate.tsx` — a single small card with the
text "Sign in with your Google account to see your personalized feed." and a
sign-in button (a Cloudflare Turnstile widget + button when `turnstileSiteKey`
is set, else a plain fallback button → `/auth/login`). There is no page that
explains what the app is.

Authenticated visitors at `/` see their curated feed (`HomePage`), unchanged by
this work.

## Goal

Replace the bare `SignIn` card with a clear, minimalist landing page that
explains the app and carries the same sign-in call-to-action. It is shown by the
exact same `AuthGate` "denied" path — no routing changes, no new authenticated
surface.

## Requirements

1. **Trigger / placement.** The landing page is what `AuthGate` renders when the
   health check fails (status `denied`), replacing the current `SignIn` card. No
   change to `App.tsx` routes; authenticated `/` stays the feed. The landing page
   is fully unauthenticated — it makes no authenticated requests.

2. **Sign-in mechanics unchanged.** Preserve the existing behavior exactly:
   - Read `GET /auth/config` via `apiFetch(authConfigSchema)`.
   - While loading config: a quiet "Loading…" affordance.
   - When `turnstileSiteKey` is set: render the Turnstile widget and a "Sign in
     with Google" button that navigates to
     `/auth/login?cf-turnstile-response=<token>` once a token resolves (button
     disabled until then).
   - When `null` (local/e2e): a plain "Sign in with Google" button →
     `/auth/login`.
   - The Turnstile script-injection / explicit-render logic is kept as-is (move
     it, don't rewrite its behavior).

3. **Content — explains the app.** Plain, accurate copy derived from the real
   product (no invented features):
   - A brand mark consistent with the app (the orange `#ff6600` "J" box +
     "news", as in `Layout`'s header).
   - A hero: a short headline + one or two sentences on what it is — a public,
     AI-curated Hacker News front page; sign in with Google and get your own feed
     filtered to your interests.
   - A short "how it works" explainer (≈3 steps), accurate to the product:
     (1) sign in with Google; (2) describe what you want to read in plain text;
     (3) AI filters the HN front page to your interests — on demand and each
     morning, with an optional Telegram daily digest.
   - The sign-in CTA from requirement 2.

4. **Style.** Light theme; reuse the app's design tokens (Tailwind theme vars,
   Geist font, shadcn primitives — `Button`, `Card` where they fit). Minimalist,
   modern, clear — not flashy. Consistent with the existing UI (orange accent
   used sparingly as a brand cue, neutral grayscale body, generous whitespace,
   `max-w-*` centered column). Responsive (mobile → desktop). No new dependencies,
   no new color tokens, no images/illustrations beyond the existing brand mark.

5. **Project rules.** No `as` casts (only `as const`). No comments except short
   inline notes for genuinely non-obvious code. Pass `pnpm check`. Keep
   `src/CLAUDE.md` accurate (the AuthGate bullet currently says it "shows a
   'Sign in with Google' screen" — update to reflect the landing page).

## Non-goals

- No new routes, no authenticated landing/marketing page, no nav changes.
- No dark-mode toggle (the app ships light-only today).
- No backend/API/schema changes.
- No screenshots, testimonials, pricing, or analytics.

## Implementation sketch

- Add `src/pages/LandingPage.tsx` (or `src/components/LandingPage.tsx`) holding
  the explainer layout and embedding the sign-in CTA.
- Move the sign-in CTA logic (Turnstile gate + fallback button + `/auth/config`
  fetch) out of `AuthGate`'s `SignIn` into a small reusable piece used by the
  landing page; `AuthGate`'s `denied` branch renders the landing page.
- Keep `useUser` / `UserContext` and the loading/denied/ok state machine in
  `AuthGate` intact.

## Tests

- **e2e (`e2e/auth.spec.ts`, no auth fixture so health 401s):**
  - Keep: the "Sign in with Google" button is visible to an unauthenticated
    visitor.
  - Add: the landing page shows its explainer — assert a stable headline / the
    brand "news" mark and at least one "how it works" step is visible.
- `pnpm check` green (format, lint, types, knip, jscpd, terraform, unit tests).

## Decisions

- [AI] Landing page replaces the `SignIn` card on the existing `AuthGate`
  "denied" path; no routing change and authenticated `/` is untouched. Rationale:
  the request is explicitly an unauthenticated page and this is the one place an
  unauthenticated visitor lands.
- [AI] Sign-in mechanics (Turnstile + fallback, `/auth/config`) are preserved
  verbatim, just relocated into a reusable CTA — keeps the security/bot-gating
  behavior identical.
- [AI] Light theme, orange brand mark reused as the only accent, neutral
  grayscale body — matches the existing app rather than introducing a new look.
- [AI] Copy is limited to real product capabilities (Google sign-in, plain-text
  preferences, AI HN filtering on demand + morning cron, optional Telegram
  digest); no invented features.
