import { useEffect, useRef } from "react";
import { StoryRow } from "@/components/StoryRow";
import { useFeed } from "@/context/FeedContext";

function RefreshingNotice() {
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
      />
      Refreshing your stories…
    </li>
  );
}

export function HomePage() {
  const { data, loading, error, refreshing, refresh, recordOpen } = useFeed();

  // Visiting the homepage re-curates the feed; the backend rate-limits the
  // upstream HN fetch to once / 5 min, so this is cheap on repeat visits.
  const refreshed = useRef(false);
  useEffect(() => {
    if (refreshed.current) {
      return;
    }
    refreshed.current = true;
    refresh();
  }, [refresh]);

  if (error !== null) {
    return <p className="text-sm text-destructive">Could not load stories.</p>;
  }
  const stories = data?.stories ?? [];
  if (!refreshing && stories.length === 0) {
    if (loading && data === undefined) {
      return <p className="text-sm text-muted-foreground">Loading…</p>;
    }
    return (
      <p className="text-sm text-muted-foreground">
        No stories yet. Set your interests on the preferences page, then hit
        Refresh — the feed also updates each morning at 06:20.
      </p>
    );
  }
  return (
    <ol className="list-none">
      {refreshing && <RefreshingNotice />}
      {stories.map((story, index) => (
        <StoryRow
          key={story.id}
          story={story}
          rank={index + 1}
          onOpen={recordOpen}
        />
      ))}
    </ol>
  );
}
