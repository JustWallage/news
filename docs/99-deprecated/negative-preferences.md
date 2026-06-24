# Negative preferences ("what I'm not interested in")

Split the preferences UI into two labelled inputs: "What I'm interested in" and
"What I'm not interested in". Each has a visible title above the field — not a
placeholder, which reads less clearly. The negative blob is stored alongside the
positive one and passed to the morning filter.

Because the digest is a classification task (the AI scores existing stories, it
does not generate text), the "model surfaces the thing you excluded" failure
mode does not apply — exclusions are a reliable filter signal. In the prompt,
keep the two as separate labelled sections (not woven into one blob), state that
exclusion wins over inclusion, and omit the exclusion section entirely when it is
empty. Validate quality with a real-model eval (Workers AI, run manually — CI has
no creds), not a deterministic unit test.
