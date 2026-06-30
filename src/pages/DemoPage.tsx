import { demoFeedSchema } from "@shared/api";
import { Link } from "react-router";
import { StoryRow } from "@/components/StoryRow";
import { Button } from "@/components/ui/button";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { relativeTime } from "@/lib/format";

export function DemoPage() {
  const { data, loading, error } = useCachedFetch(
    "/public/feed",
    demoFeedSchema,
  );
  const stories = data?.stories ?? [];

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 pt-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-sm bg-[#ff6600] text-sm font-bold leading-none text-white">
            J
          </span>
          <span className="text-lg font-bold tracking-tight">news</span>
        </Link>
        <Button render={<Link to="/" />} nativeButton={false} size="sm">
          Sign in
        </Button>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          The owner{"’"}s live picks
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          These are my picks — sign in to get your own feed tuned to yours.
          {data?.lastCuratedAt != null &&
            ` Last refreshed ${relativeTime(data.lastCuratedAt)}.`}
        </p>

        {data?.preferences ? (
          <div className="mt-4">
            <label
              htmlFor="demo-preferences"
              className="text-sm font-medium text-foreground"
            >
              Based on these preferences:
            </label>
            <textarea
              id="demo-preferences"
              readOnly
              rows={2}
              value={data.preferences}
              className="mt-1.5 w-full resize-none rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-muted-foreground"
            />
          </div>
        ) : null}

        <div className="mt-6">
          {error !== null ? (
            <p className="text-sm text-destructive">
              Could not load the demo feed.
            </p>
          ) : loading && data === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : stories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No picks yet — check back soon.
            </p>
          ) : (
            <ol className="list-none">
              {stories.map((story, index) => (
                <StoryRow key={story.id} story={story} rank={index + 1} />
              ))}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
