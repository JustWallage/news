import { healthSchema } from "@shared/api";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

const UserContext = createContext<string>("");

export const useUser = (): string => useContext(UserContext);

type GateState =
  | { status: "loading" }
  | { status: "ok"; email: string }
  | { status: "denied" };

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    apiFetch("/api/health", healthSchema)
      .then((health) => {
        setState({ status: "ok", email: health.email });
      })
      .catch(() => {
        setState({ status: "denied" });
      });
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in with your Google account to see your personalized feed.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = "/auth/login";
              }}
            >
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <UserContext.Provider value={state.email}>{children}</UserContext.Provider>
  );
}
