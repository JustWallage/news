import { digestRunResultSchema, feedItemListSchema } from "@shared/api";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { FeedItemRow } from "@/components/FeedItemRow";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { useRecordOpen } from "@/hooks/useRecordOpen";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function FeedPage() {
  const params = useParams();
  const feedId = Number(params.feedId);
  const itemsPath = `/api/feeds/${String(feedId)}/items`;
  const { data, loading, error, mutate } = useCachedFetch(
    itemsPath,
    feedItemListSchema,
  );
  const recordOpen = useRecordOpen(itemsPath, mutate);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  if (!Number.isInteger(feedId) || feedId <= 0) {
    return <p className="text-sm text-destructive">Unknown feed.</p>;
  }

  const refresh = (): void => {
    setRefreshing(true);
    setRefreshError(null);
    apiFetch(`/api/feeds/${String(feedId)}/run`, digestRunResultSchema, {
      method: "POST",
    })
      .then(() => {
        mutate();
      })
      .catch((cause: unknown) => {
        setRefreshError(
          cause instanceof ApiRequestError && cause.status === 429
            ? "You refreshed recently — try again in a few minutes."
            : "Could not refresh this feed.",
        );
      })
      .finally(() => {
        setRefreshing(false);
      });
  };

  const items = data?.items ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/feeds"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All feeds
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Link
            to={`/feeds/${String(feedId)}/archive`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Archive
          </Link>
          <Link
            to={`/feeds/${String(feedId)}/settings`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Settings
          </Link>
        </div>
      </div>

      {refreshError !== null && (
        <p className="text-sm text-destructive">{refreshError}</p>
      )}
      {error !== null ? (
        <p className="text-sm text-destructive">Could not load this feed.</p>
      ) : loading && data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {refreshing
            ? "Fetching your sources…"
            : "No items yet. Add sources and preferences in Settings, then hit Refresh."}
        </p>
      ) : (
        <>
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
          {data?.lastFetchedAt != null && (
            <p className="text-xs text-muted-foreground">
              Last fetched {relativeTime(data.lastFetchedAt)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
