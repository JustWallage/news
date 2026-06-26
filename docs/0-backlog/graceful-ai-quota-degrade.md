# Graceful degradation when Workers AI quota is exhausted

On the free Workers AI tier (~10,000 Neurons/day) a traffic spike will exhaust
the daily Neuron budget. When that happens `ai.run()` starts failing, and right
now there is no friendly handling — the homepage Refresh and the Telegram digest
should degrade, not error.

Two surfaces need a clear message:

- **Website**: when a digest run fails because AI is unavailable/over quota,
  return a distinct, non-500 response and show the user a calm message
  ("Curation is taking a break — showing your last results" or "We've hit today's
  AI limit, back tomorrow"). Keep serving the user's existing stored `curations`
  (the feed is DB-backed) so the page still renders their last good feed instead
  of breaking.
- **Telegram bot**: when `/fetch` (or a scheduled slot) can't curate, send a
  short plain-text notice rather than silently failing or sending an empty/garbled
  digest.

Detect the condition by catching the AI error in the digest path (Workers AI
surfaces quota/capacity errors from `ai.run()`); distinguish "no AI available"
from "AI ran and found nothing relevant" so an empty-but-successful run still
reads as success. Consider an optional global daily AI-budget counter (e.g. a D1
row or KV) so the app can pre-emptively skip the AI call and show the degraded
message before spending the failing request.

Add e2e coverage with a fake AI that throws, asserting both the web feed still
renders the last stored curations and the Telegram path sends the notice.
