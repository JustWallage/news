import {
  FEED_TITLE_MAX_LENGTH,
  feedCreatedSchema,
  feedListSchema,
} from "@shared/api";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch, jsonInit } from "@/lib/api";

export function FeedsPage() {
  const { data, loading, error } = useCachedFetch("/api/feeds", feedListSchema);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  const create = (): void => {
    if (title.trim() === "") {
      return;
    }
    setCreating(true);
    setCreateError(false);
    apiFetch("/api/feeds", feedCreatedSchema, jsonInit("POST", { title }))
      .then(({ id }) => {
        void navigate(`/feeds/${String(id)}/settings`);
      })
      .catch(() => {
        setCreateError(true);
      })
      .finally(() => {
        setCreating(false);
      });
  };

  if (error !== null) {
    return <p className="text-sm text-destructive">Could not load feeds.</p>;
  }
  if (loading && data === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const feeds = data?.feeds ?? [];
  return (
    <div className="space-y-6">
      {feeds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No feeds yet. Create one below, add RSS sources, and describe what you
          want to read — the AI picks the matching items for you.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {feeds.map((feed) => (
            <Link
              key={feed.id}
              to={`/feeds/${String(feed.id)}`}
              className="block"
            >
              <Card className="h-full transition-colors hover:border-foreground/40">
                <CardHeader>
                  <CardTitle>{feed.title}</CardTitle>
                  <CardDescription className="line-clamp-3 whitespace-pre-line">
                    {feed.preferencesText === ""
                      ? "No preferences yet — showing everything."
                      : feed.preferencesText}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New feed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <Input
              value={title}
              aria-label="Feed title"
              placeholder="e.g. Dev blogs"
              maxLength={FEED_TITLE_MAX_LENGTH}
              className="max-w-xs"
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
            <Button type="submit" disabled={creating || title.trim() === ""}>
              {creating ? "Creating…" : "Create feed"}
            </Button>
          </form>
          {createError && (
            <p className="text-sm text-destructive">Could not create feed.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
