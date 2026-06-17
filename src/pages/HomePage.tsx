import { digestRunResultSchema, okSchema, storyListSchema } from "@shared/api";
import { useState } from "react";
import { StoryRow } from "@/components/StoryRow";
import { Button } from "@/components/ui/button";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch } from "@/lib/api";

export function HomePage() {
  const { data, loading, error, mutate } = useCachedFetch(
    "/api/stories",
    storyListSchema,
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = (): void => {
    setRefreshing(true);
    apiFetch("/api/digest/run", digestRunResultSchema, { method: "POST" })
      .then(() => {
        mutate();
      })
      .catch(() => undefined)
      .finally(() => {
        setRefreshing(false);
      });
  };

  const recordOpen = (id: number): void => {
    // Fire-and-forget: the link opens in a new tab regardless.
    void apiFetch(`/api/stories/${id}/open`, okSchema, {
      method: "POST",
    }).catch(() => undefined);
  };

  const stories = data?.stories ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error !== null ? (
        <p className="text-sm text-destructive">Could not load stories.</p>
      ) : loading && data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : stories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No stories yet. Set your interests on the preferences page, then
          Refresh — the feed also updates each morning at 06:20.
        </p>
      ) : (
        <ol className="list-none">
          {stories.map((story, index) => (
            <StoryRow
              key={story.id}
              story={story}
              rank={index + 1}
              onOpen={recordOpen}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
