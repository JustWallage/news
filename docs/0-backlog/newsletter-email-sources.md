# Newsletter email addresses as feed sources

Give each feed a generated address (e.g. `feed-<code>@justwallage.nl`) the user
enters on newsletter signup forms; incoming mail becomes feed items.

Deferred from the feeds feature (docs/specs/feeds) because receiving mail is an
infra project of its own: Cloudflare Email Routing on the zone (Terraform +
DNS), a catch-all rule routed to a worker `email()` handler, MIME parsing (e.g.
postal-mime), plus abuse handling for a publicly guessable address space.
Email sending was already deferred once for similar reasons
(docs/1-in-progress/email-signup.md).

Schema path back in is additive: a `kind` column on `feed_sources` (default
`'rss'`) plus an `address` column; ingestion writes `feed_items` exactly like
the RSS path (title + link → AI curation → send-once Telegram digests).
