# Backlog — future ideas (not implemented)

Deliberately out of scope for v1. The data model is built so these stay cheap to
add later (the `stories` cache is persistent and `curations` keeps every story
ever selected per user, with relevance score + reason).

## 1. Archive of all previously selected stories

A page that shows every story ever curated for a user, not just their current
feed. The `curations` table already keeps all rows per user (only the `current`
flag distinguishes the live feed), so this is a read query (drop the
`current = true` filter) plus an archive route + page. Consider pagination and
grouping by `curatedAt`.

## 2. Like / dislike feedback that updates preferences

Let me thumbs-up / thumbs-down a story. Those signals feed back into the
preferences the morning filter uses — either by appending learned examples to
the preferences text, or a separate liked/disliked set the prompt references.
Needs: per-curation feedback storage, a UI control on each row, and a step in
the digest that folds the feedback into what the AI sees.
