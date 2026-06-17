// Display helpers for the Hacker-News-style story list.

export function hostname(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const UNITS: { limit: number; secs: number; label: string }[] = [
  { limit: 60, secs: 1, label: "second" },
  { limit: 3600, secs: 60, label: "minute" },
  { limit: 86400, secs: 3600, label: "hour" },
  { limit: 2592000, secs: 86400, label: "day" },
  { limit: 31536000, secs: 2592000, label: "month" },
  { limit: Infinity, secs: 31536000, label: "year" },
];

export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) {
    return "just now";
  }
  for (const unit of UNITS) {
    if (seconds < unit.limit) {
      const value = Math.floor(seconds / unit.secs);
      return `${value} ${unit.label}${value === 1 ? "" : "s"} ago`;
    }
  }
  return "long ago";
}

export const hnItemUrl = (id: number): string =>
  `https://news.ycombinator.com/item?id=${id}`;
