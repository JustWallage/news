import { StoryRow } from "@/components/StoryRow";
import { useFeed } from "@/context/FeedContext";

export function HomePage() {
  const { data, loading, error, recordOpen } = useFeed();

  if (error !== null) {
    return <p className="text-sm text-destructive">Could not load stories.</p>;
  }
  if (loading && data === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const stories = data?.stories ?? [];
  if (stories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stories yet. Set your interests on the preferences page, then hit
        Refresh — the feed also updates each morning at 06:20.
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
