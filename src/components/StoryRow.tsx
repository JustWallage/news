import type { Story } from "@shared/api";
import { hnItemUrl, hostname, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StoryRow({
  story,
  rank,
  onOpen,
}: {
  story: Story;
  rank: number;
  onOpen: (id: number) => void;
}) {
  const target = story.url ?? hnItemUrl(story.id);
  const domain = hostname(story.url);
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
            onOpen(story.id);
          }}
          className={cn(
            "font-medium hover:underline",
            story.openedAt !== null && "text-muted-foreground",
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
