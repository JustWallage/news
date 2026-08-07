import { feedItemListSchema } from "@shared/api";
import { Link, useParams } from "react-router";
import { FeedItemRow } from "@/components/FeedItemRow";
import { buttonVariants } from "@/components/ui/button";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { useRecordOpen } from "@/hooks/useRecordOpen";
import { cn } from "@/lib/utils";

export function FeedArchivePage() {
  const params = useParams();
  const feedId = Number(params.feedId);
  const { data, loading, error, mutate } = useCachedFetch(
    `/api/feeds/${String(feedId)}/archive`,
    feedItemListSchema,
  );
  const recordOpen = useRecordOpen(
    `/api/feeds/${String(feedId)}/items`,
    mutate,
  );

  if (!Number.isInteger(feedId) || feedId <= 0) {
    return <p className="text-sm text-destructive">Unknown feed.</p>;
  }
  const items = data?.items ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/feeds/${String(feedId)}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          ← Back to feed
        </Link>
        <span className="text-sm text-muted-foreground">· archive</span>
      </div>
      {error !== null ? (
        <p className="text-sm text-destructive">Could not load the archive.</p>
      ) : loading && data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Every item the AI ever picks for this feed stays
          available on this page.
        </p>
      ) : (
        <ol className="list-none">
          {items.map((item, index) => (
            <FeedItemRow
              key={item.id}
              item={item}
              rank={index + 1}
              onOpen={recordOpen}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
