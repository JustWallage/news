# Like / dislike feedback that updates preferences

Let me thumbs-up / thumbs-down a story. Those signals feed back into the
preferences the morning filter uses — either by appending learned examples to
the preferences text, or a separate liked/disliked set the prompt references.
Needs: per-curation feedback storage, a UI control on each row, and a step in
the digest that folds the feedback into what the AI sees.
This must result in some kind of update to the user's preferences, and this is stored in the db.
