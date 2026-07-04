# LLM-optimization audit — 2026-07-04

Scope: how effectively an AI agent (specifically Opus-class, going forward) can
work in this repo. Method: read every CLAUDE.md + harness config, then actually
exercised the feedback loops in a fresh Claude Code on the web container —
`pnpm check`, unit, lint, ts, and Playwright e2e — and measured what breaks and
what it costs.

What's already strong (verified, no action): the `as`-cast lint ban, shared/
zod contracts, knip/jscpd gates, hermetic e2e with per-test users, deterministic
DI fakes, nested CLAUDE.md files that mostly carry genuinely non-discoverable
invariants (the worker/ digest/versioning notes are exactly what an agent can't
cheaply infer). The foundation is good; everything below is delta.

## P0 — broken feedback loops in fresh (remote) sessions

These bite every web/agent session. An agent in a broken loop either burns
tokens diagnosing the environment instead of the task, or worse, learns to
bypass the gate. Opus is more prone to both than Fable.

### 1. `pnpm check` can never pass → commits are impossible

`check:tf` needs `terraform init` providers. The session-start hook installs
the terraform _binary_ but never runs `pnpm tf:init`; and in the container the
init itself fails — the cloudflare provider's checksums/binary download from
github.com releases gets `403 Forbidden` through the egress proxy
(`releases.hashicorp.com` is allowlisted; the provider registry's GitHub-hosted
artifacts are not). Since `.husky/pre-commit` = `pnpm check`, **no agent can
make any commit in a remote session without `--no-verify`** (which CLAUDE.md
rightly forbids).

Fix (all three):

- Add `registry.terraform.io`, `github.com` + `objects.githubusercontent.com`
  (provider release artifacts) to the environment's network allowlist.
- Run `pnpm tf:init` in `.claude/hooks/session-start.sh` after installing
  terraform (it's already async).
- Optional resilience: make `check:tf` degrade loudly-but-green when
  `iac/.terraform/` is absent AND init is unreachable, so an offline gate
  failure can't teach an agent to bypass the whole hook. (Skip this if the
  allowlist fix is applied — a silent skip is its own hazard.)

### 2. e2e is 100% red until `.dev.vars` exists

`.dev.vars` is gitignored and not created at session start, so the e2e worker
has no `TEST_AUTH_TOKEN`; every authenticated test fails — with a _misleading_
symptom (landing page instead of feed, i.e. looks like an app bug, not an env
gap). Verified: `cp .dev.vars.example .dev.vars` → full `home.spec.ts` goes
8/8 green in 14s.

Fix: in session-start.sh, `[ -f .dev.vars ] || cp .dev.vars.example .dev.vars`,
and one gotcha line in `e2e/CLAUDE.md` ("all tests failing on the landing page
⇒ `.dev.vars` is missing").

## P1 — stale docs (violates the repo's own top rule)

- Root CLAUDE.md links `docs/BACKLOG.md` — it no longer exists; the backlog is
  `docs/0-backlog/`.
- Root CLAUDE.md "Shared patterns in `docs/claude/`" — the directory doesn't
  exist. Create it or cut the sentence.
- The actual docs workflow is undocumented: `docs/{0-backlog,1-in-progress,
3-done,99-deprecated}/` kanban + `docs/specs/<feature>/index.md` with
  `review-N` / `sa-validation-N` companions. An agent finishing a feature has
  no instruction to move its doc to `3-done/` or where a new spec goes. Two
  lines in root CLAUDE.md fix this.
- `e2e/CLAUDE.md`: "Mock 100 stories to hit D1 limits on e2e, thus chucking
  must work in pipeline test phase on real D1" — garbled ("chunking"), reads as
  noise. Rewrite: "e2e seeds ~100 stories so the chunked D1 upserts
  (100-bound-param limit) are exercised against real D1 in the pipeline."

## P1 — teach the fast loop (biggest cheap win for Opus)

Measured on a warm container: `check:ts` 9s, `check:lint` 10s, `test:unit`
20s, full `pnpm check` ~60s. Nothing tells an agent this; the docs only ever
mention the 60s full gate, so that's what a literal-minded model runs after
every edit. Add ~5 lines to root CLAUDE.md:

- Iterate with `pnpm check:ts` (9s); full `pnpm check` once, before commit.
- Single unit test: `pnpm vitest run worker/lib/ai.test.ts`.
- Single e2e: `pnpm exec playwright test e2e/home.spec.ts --grep "title"`
  (auto-starts its own server; ~15s warm).
- `pnpm fix` auto-repairs format+lint — run it instead of reading prettier
  diffs.

Also: `check` invokes `cf-typegen` twice (once directly, once inside
`check:ts`) — drop one (~3s/run, every commit forever).

## P1 — harness config (.claude/)

- **Permissions allowlist**: `settings.json` has only the SessionStart hook.
  Every `pnpm`/`git` invocation prompts in local interactive sessions. Add
  `permissions.allow` for the read-only + gate commands (`pnpm check*`,
  `pnpm test:*`, `pnpm vitest*`, `pnpm exec playwright*`, `pnpm fix`,
  `git status/diff/log/show`, …). The `/fewer-permission-prompts` skill
  generates this from real transcripts.
- **Auto-format hook**: a PostToolUse hook on Edit|Write running
  `prettier --write <file>` deterministically eliminates the most common
  check failure class (`check:format`) and its whole retry loop. This is the
  kind of "don't rely on the model remembering" guardrail that pays off most
  on Opus.

## P2 — worth doing, lower urgency

- **CI on PRs**: feature branches run nothing unless the commit title contains
  `run-pipeline`, and PRs trigger nothing at all. Agent-opened PRs therefore
  show no green/red to the reviewing human (or to a follow-up agent session).
  Add a `pull_request` trigger running the cheap `check-and-build` job only
  (keep ephemeral e2e opt-in via `run-pipeline`/label).
- **Scope the worktree rule**: "Before implementing a new feature, create an
  isolated worktree" is wrong in web/CI sessions — the container is already
  isolated on a dedicated branch, and an agent following it literally wastes a
  full `pnpm install` + copies. Scope it: "local interactive sessions only;
  remote sessions are already isolated."
- **Project skills**: the review loop lives in the external `justly-skilled`
  repo; the repo itself ships zero skills. Two candidates that encode
  multi-step flows currently smeared across CLAUDE.md/scripts/conventions:
  `new-feature` (worktree → `docs/specs/<name>/index.md` → implement → e2e →
  `pnpm merge` → move doc to `3-done/`) and a `verify` skill (how to prove a
  change works: which page, which e2e spec, what the fake AI responds to).
  Skills load on demand — they don't tax the context of unrelated sessions the
  way CLAUDE.md lines do.
- **Prune narrative CLAUDE.md content**: by the repo's own bar ("would a
  competent reader get this WRONG without it?"), parts of `src/CLAUDE.md`
  narrate what the code shows in 30 seconds (the TelegramSection walkthrough,
  the Refresh-button flow), and `worker/CLAUDE.md` (221 lines, ~4k tokens —
  injected into every worker-touching session) restates some of what
  `wrangler.jsonc` + `env.ts` types already enforce. Keep the invariants
  (versioning/skip rules, chunking, fail-open/closed gates, the `__Host-`
  cookie footgun); cut the UI tours. Smaller injections matter more for Opus
  than for Fable — effective attention over long boilerplate degrades first.
- **Quiet the gate output**: jscpd prints a full stats table + ads on every
  run (`"reporters": ["consoleFull"]`); prettier/knip are also chatty. Every
  line is tokens an agent re-reads on every check. Switching `consoleFull` to
  `console` plus `"silent": true` style options cuts it to the failures.

## Suggested order

| #   | Change                                                                           | Effort | Payoff                                    |
| --- | -------------------------------------------------------------------------------- | ------ | ----------------------------------------- |
| 1   | session-start: `tf:init` + `.dev.vars` copy; egress allowlist                    | tiny   | commits + e2e work at all, remotely       |
| 2   | Fix stale refs; document docs-kanban + fast-loop/single-test commands            | tiny   | fewer wasted diagnostic turns             |
| 3   | Permissions allowlist + prettier PostToolUse hook                                | small  | autonomy + kills the format retry loop    |
| 4   | PR-triggered checks; scope worktree rule                                         | small  | agents get CI signal; no wasted worktrees |
| 5   | Project skills (`new-feature`, `verify`); prune narrative CLAUDE.md; quiet gates | medium | compounding token/attention savings       |
