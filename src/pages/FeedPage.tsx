import {
  digestRunResultSchema,
  feedItemListSchema,
  feedListSchema,
} from "@shared/api";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { FeedItemRow } from "@/components/FeedItemRow";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// The top bar every feed page shares: switch feeds, go back to the overview,
// and jump to the archive/settings of the selected feed.
export function FeedSwitcher({ feedId }: { feedId: number }) {
  const { data } = useCachedFetch("/api/feeds", feedListSchema);
  const navigate = useNavigate();
  const feeds = data?.feeds ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to="/feeds"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← All feeds
      </Link>
      <select
        aria-label="Selected feed"
        value={String(feedId)}
        onChange={(event) => {
          void navigate(`/feeds/${event.target.value}`);
        }}
        className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {feeds.map((feed) => (
          <option key={feed.id} value={String(feed.id)}>
            {feed.title}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FeedPage() {
  const params = useParams();
  const feedId = Number(params.feedId);
  const itemsPath = `/api/feeds/${String(feedId)}/items`;
  const { data, loading, error, mutate } = useCachedFetch(
    itemsPath,
    feedItemListSchema,
  );
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
        <FeedSwitcher feedId={feedId} />
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
          <Link
            to="/feeds"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            New feed
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
              <FeedItemRow key={item.id} item={item} rank={index + 1} />
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
