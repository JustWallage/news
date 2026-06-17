import {
  digestRunResultSchema,
  okSchema,
  storyListSchema,
  type StoryList,
} from "@shared/api";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch } from "@/lib/api";

interface FeedValue {
  data: StoryList | undefined;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
  recordOpen: (id: number) => void;
}

const FeedContext = createContext<FeedValue | null>(null);

export function useFeed(): FeedValue {
  const ctx = useContext(FeedContext);
  if (ctx === null) {
    throw new Error("useFeed must be used within FeedProvider");
  }
  return ctx;
}

// Lifts the feed query so the header's Refresh button and the home list share
// one source: refresh runs the digest, then revalidates the feed in place.
export function FeedProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, mutate } = useCachedFetch(
    "/api/stories",
    storyListSchema,
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    apiFetch("/api/digest/run", digestRunResultSchema, { method: "POST" })
      .then(() => {
        mutate();
      })
      .catch(() => undefined)
      .finally(() => {
        setRefreshing(false);
      });
  }, [mutate]);

  const recordOpen = useCallback((id: number) => {
    // Fire-and-forget: the link opens in a new tab regardless.
    void apiFetch(`/api/stories/${id}/open`, okSchema, {
      method: "POST",
    }).catch(() => undefined);
  }, []);

  return (
    <FeedContext.Provider
      value={{ data, loading, error, refreshing, refresh, recordOpen }}
    >
      {children}
    </FeedContext.Provider>
  );
}
