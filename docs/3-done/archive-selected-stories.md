# Archive of all previously selected stories

A page that shows every story ever curated for a user, not just their current
feed. The `curations` table already keeps all rows per user (only the `current`
flag distinguishes the live feed), so this is a read query (drop the
`current = true` filter) plus an archive route + page. Consider pagination and
grouping by `curatedAt`.
