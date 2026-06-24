# Review 1: Unauthenticated landing page

Spec: `docs/specs/landing-page/index.md`
Branch: `landing-page` (diff against `main`)

## Summary

Replaces the bare `SignIn` card on `AuthGate`'s `denied` branch with a new
`src/components/LandingPage.tsx` that explains the product and carries the
relocated sign-in CTA. The Turnstile gate + `/auth/config` fetch + plain
fallback were moved verbatim into the new file (`TurnstileGate` is character-for-
character identical to the old one). No routes, no backend, no schema, no new
deps. `pnpm check` is green and the e2e assertions were updated. The change is
minimal and matches the spec and its SA-validation guidance.

## Findings per axis

### Simplicity — clean

The smallest correct shape: `AuthGate.tsx` shrinks to the state machine plus a
one-line `<LandingPage />` render on `denied`; all sign-in mechanics move into
`LandingPage.tsx`. No abstraction beyond the necessary CTA extraction. The
`steps` array driving the "how it works" list is a reasonable, readable choice.

### Spec implementation — clean

- Req 1 (trigger/placement): `AuthGate.tsx:43` renders `<LandingPage />` on
  `status === "denied"`; no `App.tsx` route changes. The page makes no
  authenticated requests (only `GET /auth/config`).
- Req 2 (sign-in mechanics unchanged): `LandingPage.tsx:6-122` preserve the
  loading "Loading…" affordance, the Turnstile-set path
  (`/auth/login?cf-turnstile-response=<token>`, button disabled until token),
  the `null` fallback (`/auth/login`), and the script-injection / explicit-render
  logic verbatim.
- Req 3 (content): brand mark (`BrandMark`), hero headline + accurate one-liner,
  three-step explainer accurate to the product (Google sign-in; plain-text
  preferences; AI HN filtering on demand + every morning + optional Telegram
  digest). No invented features.
- Req 4 (style): light theme, `bg-background`/`text-foreground`/
  `text-muted-foreground` tokens, `Button` primitive, `max-w-2xl` centered
  column, responsive (`sm:` breakpoints), orange used only as the brand cue. No
  new deps/tokens/images.
- Req 5 (project rules): no `as` casts; comment retained only on the non-obvious
  Turnstile render-once logic; `src/CLAUDE.md` AuthGate bullet updated to
  describe `LandingPage`.

Note: the SA-validation flagged that copying `Layout`'s brand-mark markup
verbatim (white border + white text on the orange header) would render
invisibly on a light page. The implementation correctly diverges, giving the `J`
box an orange fill (`bg-[#ff6600] ... text-white`, `LandingPage.tsx:127`), which
reads correctly on the light background and satisfies the "brand cue" intent.

### No shortcuts — clean

No stubs, TODOs, swallowed errors, or hacks. The one `.catch(() => setSiteKey(null))`
on the config fetch is the pre-existing, intended fallback-to-plain-button
behavior, not a swallowed error introduced here.

### Code quality — clean

Clear, follows existing conventions (shadcn `Button`, Tailwind tokens, named
function components). The old unused `SignIn`/`TurnstileGate`/`Card` imports were
fully removed from `AuthGate.tsx`, so knip stays green (it passed in `pnpm check`).

### Tests — clean

`e2e/auth.spec.ts` updated to assert the landing page renders: the
`/Hacker News, filtered/i` heading, a "Describe what you want to read" step, and
the existing "Sign in with Google" button visibility. Coverage matches the spec's
test requirement. The change is presentational with no new branching logic
beyond the relocated CTA, which the e2e button assertion exercises.

## Action list

None.

VERDICT: APPROVED
