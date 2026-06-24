# SA Validation: Unauthenticated landing page

Spec: `docs/specs/landing-page/index.md`
Reviewed against the real codebase in `/Users/just/Documents/code-personal/news.worktrees/landing-page`.

## Summary

A purely client-side, presentational change: replace the bare `SignIn` card on
`AuthGate`'s `denied` branch with an explainer landing page that carries the
same sign-in CTA. No routes, no backend, no schema, no new deps. Every concrete
claim in the spec was verified against the actual code and holds. The design is
sound, right-sized (genuinely the smallest correct change), and fits existing
patterns. Approving with two minor, non-blocking notes for the implementer.

## Soundness

The spec correctly identifies the single place an unauthenticated visitor lands:
`AuthGate` (`src/components/AuthGate.tsx`) calls `/api/health`; on rejection it
sets `status: "denied"` and renders `<SignIn />`. Verified at lines 156-176.
Replacing that render with a landing page is exactly the right shape — it needs
no routing because `App.tsx` already wraps the whole `<Routes>` tree in
`<AuthGate>`, so unauthenticated users never reach the router's routes. Confirmed
in `src/App.tsx`.

The instruction to relocate the sign-in mechanics verbatim (Turnstile gate +
`/auth/config` fetch + plain fallback) rather than rewrite them is the correct
call: that logic is security/bot-gating and the `useRef` "render once" guard in
`TurnstileGate` is deliberately non-obvious (it even carries an explanatory
comment). Lifting it into a reusable CTA preserves behavior. Sound.

## Right-sizing

Correctly minimal. No new route, no marketing surface, no images, no deps, no new
tokens. The spec explicitly forbids scope creep (non-goals list). The
"how it works" content is bounded to real product capabilities, and the
Decisions section documents that copy must not invent features. No
over-engineering and no under-engineering observed — the one refactor it
mandates (extracting the CTA) is the necessary minimum to avoid duplicating the
Turnstile logic between the landing page and any future caller, and also keeps
`SignIn`'s wrapper from leaking landing-page layout into the auth machine.

## Codebase fit

- Design tokens exist as claimed: `src/index.css` defines `--font-sans` =
  "Geist Variable" (via `@fontsource-variable/geist`), plus `--background`,
  `--foreground`, `--card`, `--primary`, `--muted-foreground`. Reusing them is
  the established pattern.
- shadcn primitives `Button` and `Card` exist under `src/components/ui/` and are
  already used by `SignIn`. `src/CLAUDE.md` documents the Base-UI (not Radix)
  caveat — relevant only if the implementer needs a link-styled button; the spec
  doesn't require one, so this is just a heads-up.
- The brand mark in `Layout` (`src/components/Layout.tsx`) is a `J` span with a
  white border sitting on the `#ff6600` header background plus a black "news"
  wordmark. See note below.
- The `denied`/`loading`/`ok` state machine and `useUser`/`UserContext` are to be
  left intact — correct; nothing else consumes them.
- No existing `LandingPage` file; either suggested location
  (`src/pages/` or `src/components/`) is fine. `src/pages/` holds routed pages
  and `src/components/` holds the auth/layout shell — since this renders inside
  `AuthGate` (a component, not a route), `src/components/LandingPage.tsx` is the
  marginally better fit, but this is not load-bearing.

## Risk / gaps

Low risk overall (presentational, no data flow changes). Two items the
implementer should keep in mind, neither blocking:

1. **Brand mark on a light background.** The spec describes "the orange
   `#ff6600` 'J' box". In `Layout` the orange is the _header background_; the `J`
   span itself only has a white border (`border border-white ... text-white`) and
   no fill. Dropped onto a light landing page with no orange behind it, that
   exact markup would render as a white-bordered, white-text `J` — invisible. The
   implementer must give the mark an orange fill (e.g. `bg-[#ff6600]` on the box)
   to read as a brand cue on light. This is consistent with the spec's intent
   ("orange accent used sparingly as a brand cue") — just flagging that copying
   `Layout`'s classes verbatim would be wrong.

2. **knip on the extracted CTA.** Project rule: knip fails on unused exports. The
   extracted CTA component and the landing page must each be imported by a real
   consumer in the same change (CTA <- landing page <- AuthGate). The spec's plan
   already wires this, so it is fine as long as the implementer does not leave the
   old `SignIn` around unused — it should be removed, not kept "for reference".

## Open questions

None material. The Decisions section already resolves the only real fork
(replace-in-place vs. new route) in favor of replace-in-place, which is correct.

## Spec-change list

None required. The two risk items above are implementation guidance, not spec
defects — the spec's stated intent already covers them. Optionally the spec could
add one sentence to requirement 3 clarifying the J mark needs an orange fill on
light, but it is not necessary given the "brand cue" language.

VERDICT: APPROVED
