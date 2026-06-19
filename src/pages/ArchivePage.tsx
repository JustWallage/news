import { storyListSchema } from "@shared/api";
import { StoryRow } from "@/components/StoryRow";
import { useFeed } from "@/context/FeedContext";
import { useCachedFetch } from "@/hooks/useCachedFetch";

export function ArchivePage() {
  const { data, loading, error } = useCachedFetch(
    "/api/stories/archive",
    storyListSchema,
  );
  const { recordOpen } = useFeed();

  if (error !== null) {
    return <p className="text-sm text-destructive">Could not load archive.</p>;
  }
  if (loading && data === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const stories = data?.stories ?? [];
  if (stories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing archived yet. Stories move here once a Refresh or the morning
        digest replaces the current feed, and they stay forever.
      </p>
    );
  }
  return (
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
  );
}
