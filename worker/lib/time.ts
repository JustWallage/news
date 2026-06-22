// Digest scheduling reasons in Europe/Amsterdam wall-clock time, so a user's
// configured Telegram slot fires at the right local minute across the CET/CEST
// DST switch (the */5 cron compares against amsterdamMinuteOfDay).

const TZ = "Europe/Amsterdam";

/** YYYY-MM-DD for the given instant in Amsterdam local time. */
export function amsterdamDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Minutes since midnight (0–1439) for the given instant in Amsterdam time. */
export function amsterdamMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return (get("hour") % 24) * 60 + get("minute");
}
