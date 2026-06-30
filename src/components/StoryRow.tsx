import type { Story } from "@shared/api";
import { hnItemUrl, hostname, relativeTime, safeHref } from "@/lib/format";
import { cn } from "@/lib/utils";

// Props are a structural subset of Story so the public demo can reuse this with
// a PublicStory; onOpen is optional (the demo is read-only).
export function StoryRow({
  story,
  rank,
  onOpen,
}: {
  story: Pick<
    Story,
    "id" | "title" | "url" | "by" | "score" | "comments" | "time"
  > & { openedAt?: Story["openedAt"] };
  rank: number;
  onOpen?: (id: number) => void;
}) {
  const href = safeHref(story.url);
  const target = href ?? hnItemUrl(story.id);
  const domain = hostname(href);
  return (
    <li className="flex gap-2 py-1.5 text-sm">
      <span className="w-6 shrink-0 text-right text-muted-foreground">
        {rank}.
      </span>
      <div className="min-w-0">
        <a
          href={target}
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            onOpen?.(story.id);
          }}
          className={cn(
            "font-medium hover:underline",
            story.openedAt != null && "text-muted-foreground",
          )}
        >
          {story.title}
        </a>
        {domain !== null && (
          <span className="ml-1 text-xs text-muted-foreground">({domain})</span>
        )}
        <div className="text-xs text-muted-foreground">
          {story.score} points by {story.by} · {relativeTime(story.time)} ·{" "}
          <a
            href={hnItemUrl(story.id)}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {story.comments} comments
          </a>
        </div>
      </div>
    </li>
  );
}
