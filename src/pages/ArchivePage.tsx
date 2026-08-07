import { storyListSchema } from "@shared/api";
import { StoryRow } from "@/components/StoryRow";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { useRecordOpen } from "@/hooks/useRecordOpen";

export function ArchivePage() {
  const { data, loading, error, mutate } = useCachedFetch(
    "/api/stories/archive",
    storyListSchema,
  );
  // The archive is its own cache entry: it must revalidate itself on an open,
  // since FeedContext's recordOpen only refreshes the current feed.
  const recordOpen = useRecordOpen("/api/stories", mutate);

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
        Nothing archived yet. Every story your feed has ever shown lands here,
        most recently shown first, and stays forever.
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
