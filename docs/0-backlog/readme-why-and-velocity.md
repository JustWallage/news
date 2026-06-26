# Rewrite the README around "why" and development velocity

The README is the first file people open from the public repo (especially after
a Show HN). Right now it leans technical; reframe the top of it around the story,
since that's what a casual visitor and the HN crowd actually want.

Lead with:

- **Why it exists** — a fun project, and a deliberately _minimalistic_ app for one
  specific use-case: a personal, AI-curated Hacker News front page filtered against
  a plain-text interests blob. Not a startup, not a platform — a small, focused tool.
- **Development velocity** — it was built in less than a day's worth of hours.
  Call this out as a point of interest (small surface area, sharp scope, heavy use
  of Cloudflare's all-in-one primitives + AI-assisted development made it fast).
- Keep the existing architecture/stack section below the story (Cloudflare Worker
  serving SPA + Hono API, D1, Workers AI Llama, in-worker Google OAuth) — that
  detail is what makes the repo interesting to read, just move it under the "why".

Add a screenshot or GIF of a curated feed near the top so a reader sees the
product without signing in (ties into the public-demo item). Keep it honest and
unhyped — no buzzwords; the HN audience rewards that.
