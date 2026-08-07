import { okSchema } from "@shared/api";
import { useCallback } from "react";
import { apiFetch } from "@/lib/api";

// Records a first open (`POST <basePath>/:id/open`) and revalidates the list
// that rendered the row so it greys immediately. Each list owns its own cache
// entry (feed, archive, per-feed), so the caller passes its own `mutate`.
export function useRecordOpen(
  basePath: string,
  mutate: () => void,
): (id: number) => void {
  return useCallback(
    (id: number) => {
      // The link opens in a new tab regardless; this never blocks navigation.
      apiFetch(`${basePath}/${String(id)}/open`, okSchema, { method: "POST" })
        .then(() => {
          mutate();
        })
        .catch(() => undefined);
    },
    [basePath, mutate],
  );
}
