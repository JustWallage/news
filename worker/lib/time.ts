// Digest scheduling reasons in wall-clock time: a user's configured Telegram
// slot fires at the right local minute across DST because Intl resolves the
// offset per instant. minuteOfDayInTz powers the */5 due check.

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

/** Minutes since midnight (0–1439) for the given instant in the given IANA zone. */
export function minuteOfDayInTz(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return (get("hour") % 24) * 60 + get("minute");
}
