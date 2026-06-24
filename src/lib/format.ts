// Display helpers for the Hacker-News-style story list.

import { isHttpUrl } from "@shared/api";

// Only render http(s) story URLs as links; anything else (a `javascript:` URL
// slipping through ingestion) becomes null so the caller falls back to the HN
// item page. Defence-in-depth: React does not block dangerous href schemes.
export function safeHref(url: string | null): string | null {
  return url !== null && isHttpUrl(url) ? url : null;
}

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
