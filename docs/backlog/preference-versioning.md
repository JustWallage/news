# Preference has a version number

If changed => version bumped. For each evaluated story, store the preference version that was used. If refresh, if story already evaluated with cur preference version => skip, if new preference version => eval again. Only do this for the latest (frontpage) stories, don't re-evalutate older posts.
