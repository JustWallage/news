import type { FeedItem } from "@shared/api";
import { hostname, relativeTime, safeHref } from "@/lib/format";
import { cn } from "@/lib/utils";

export function FeedItemRow({
  item,
  rank,
  onOpen,
}: {
  item: FeedItem;
  rank: number;
  onOpen: (id: number) => void;
}) {
  const href = safeHref(item.url);
  const domain = hostname(href);
  const titleClass = cn(
    "font-medium",
    item.openedAt !== null && "text-muted-foreground",
  );
  return (
    <li className="flex gap-2 py-1.5 text-sm">
      <span className="w-6 shrink-0 text-right text-muted-foreground">
        {rank}.
      </span>
      <div className="min-w-0">
        {href === null ? (
          <span className={titleClass}>{item.title}</span>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              onOpen(item.id);
            }}
            className={cn(titleClass, "hover:underline")}
          >
            {item.title}
          </a>
        )}
        {domain !== null && (
          <span className="ml-1 text-xs text-muted-foreground">({domain})</span>
        )}
        {item.publishedAt !== null && (
          <div className="text-xs text-muted-foreground">
            {relativeTime(item.publishedAt)}
          </div>
        )}
      </div>
    </li>
  );
}
