import { authConfigSchema, healthSchema } from "@shared/api";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

const UserContext = createContext<string>("");

export const useUser = (): string => useContext(UserContext);

const TURNSTILE_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ) => string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Renders the Cloudflare Turnstile widget and resolves a token the sign-in
// request carries as `cf-turnstile-response`. The script is injected once and the
// widget rendered explicitly (robust in an SPA, unlike implicit auto-render).
function TurnstileGate({ siteKey }: { siteKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (rendered.current) {
      return;
    }
    const mount = (): void => {
      if (rendered.current || ref.current === null || !window.turnstile) {
        return;
      }
      rendered.current = true;
      window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (next) => {
          setToken(next);
        },
        "expired-callback": () => {
          setToken(null);
        },
        "error-callback": () => {
          setToken(null);
        },
      });
    };
    if (window.turnstile) {
      mount();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SRC}"]`,
    );
    if (existing !== null) {
      existing.addEventListener("load", mount);
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", mount);
    document.head.appendChild(script);
  }, [siteKey]);

  const signIn = (): void => {
    if (token === null) {
      return;
    }
    window.location.href = `/auth/login?cf-turnstile-response=${encodeURIComponent(token)}`;
  };

  return (
    <div className="space-y-4">
      <div ref={ref} />
      <Button className="w-full" onClick={signIn} disabled={token === null}>
        Sign in with Google
      </Button>
    </div>
  );
}

function SignIn() {
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    apiFetch("/auth/config", authConfigSchema)
      .then((config) => {
        setSiteKey(config.turnstileSiteKey);
      })
      .catch(() => {
        setSiteKey(null);
      });
  }, []);

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
          {siteKey === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : siteKey === null ? (
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = "/auth/login";
              }}
            >
              Sign in with Google
            </Button>
          ) : (
            <TurnstileGate siteKey={siteKey} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
    return <SignIn />;
  }

  return (
    <UserContext.Provider value={state.email}>{children}</UserContext.Provider>
  );
}
