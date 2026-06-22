// All digest scheduling reasons in Europe/Amsterdam wall-clock time, so the
// 06:20 run lands correctly across the CET/CEST DST switch (the cron fires at
// two fixed UTC times and the scheduled handler keeps only the 06:xx one).

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

/** Hour 0–23 for the given instant in Amsterdam local time. */
export function amsterdamHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(hour) % 24;
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
