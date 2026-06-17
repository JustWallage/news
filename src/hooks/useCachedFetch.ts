import { useCallback, useEffect, useState } from "react";
import type { ZodType } from "zod";
import { apiFetch } from "@/lib/api";

// Module-level cache shared across hook instances: navigating back to a page
// renders instantly from cache while a background revalidate runs.
const cache = new Map<string, unknown>();

export interface CachedFetch<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  /** Re-fetch in the background (e.g. after a mutation or WS event). */
  mutate: () => void;
}

export function useCachedFetch<T>(
  path: string,
  schema: ZodType<T>,
): CachedFetch<T> {
  const [data, setData] = useState<T | undefined>(() => {
    const cached = cache.get(path);
    return cached === undefined ? undefined : schema.parse(cached);
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(data === undefined);

  const mutate = useCallback(() => {
    apiFetch(path, schema)
      .then((fresh) => {
        cache.set(path, fresh);
        setData(fresh);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Request failed");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [path, schema]);

  useEffect(() => {
    mutate();
  }, [mutate]);

  return { data, loading, error, mutate };
}
