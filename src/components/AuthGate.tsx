import { healthSchema } from "@shared/api";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LandingPage } from "@/components/LandingPage";
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
    return <LandingPage />;
  }

  return (
    <UserContext.Provider value={state.email}>{children}</UserContext.Provider>
  );
}
