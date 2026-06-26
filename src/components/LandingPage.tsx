import {
  authConfigSchema,
  emailLoginRequestResultSchema,
  okSchema,
} from "@shared/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, jsonInit } from "@/lib/api";

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

// The magic link drops the user on the SPA at `/?login_email=…&login_code=…`.
function readMagicLink(): { email: string; code: string } | null {
  const params = new URLSearchParams(window.location.search);
  const email = params.get("login_email");
  const code = params.get("login_code");
  return email !== null && code !== null ? { email, code } : null;
}

// Renders the Cloudflare Turnstile widget and reports its token (or null on
// expiry/error) to the parent, which gates both the Google and email sign-in
// submits on it. The script is injected once and rendered explicitly (robust in
// an SPA, unlike implicit auto-render).
function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

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
          onToken(next);
        },
        "expired-callback": () => {
          onToken(null);
        },
        "error-callback": () => {
          onToken(null);
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
  }, [siteKey, onToken]);

  return <div ref={ref} />;
}

// Two-step email sign-in: request a code, then verify it. A magic link prefills
// and auto-submits the code. `ready` is false while Turnstile (when shown) has no
// token yet — verify itself never needs a token.
function EmailForm({ token, ready }: { token: string | null; ready: boolean }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoSubmitted = useRef(false);

  const verify = useCallback(
    async (emailToUse: string, codeToUse: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await apiFetch(
          "/auth/email/verify",
          okSchema,
          jsonInit("POST", { email: emailToUse, code: codeToUse }),
        );
        window.location.reload();
      } catch {
        setError("That code is invalid or expired.");
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (autoSubmitted.current) {
      return;
    }
    const link = readMagicLink();
    if (link === null) {
      return;
    }
    autoSubmitted.current = true;
    setEmail(link.email);
    setCode(link.code);
    setStep("code");
    window.history.replaceState(null, "", window.location.pathname);
    void verify(link.email, link.code);
  }, [verify]);

  const request = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        "/auth/email/request",
        emailLoginRequestResultSchema,
        jsonInit("POST", { email, turnstileToken: token }),
      );
      setStep("code");
      if (res.devCode !== undefined) {
        setCode(res.devCode);
      }
    } catch {
      setError("Couldn't send a code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "email") {
    return (
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void request();
        }}
      >
        <Input
          type="email"
          required
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <Button
          type="submit"
          variant="outline"
          size="lg"
          disabled={!ready || email.length === 0 || busy}
        >
          Email me a code
        </Button>
        {error !== null ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </form>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(email, code);
      }}
    >
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code sent to {email}.
      </p>
      <Input
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        aria-label="Sign-in code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
        }}
      />
      <Button type="submit" size="lg" disabled={code.length === 0 || busy}>
        Sign in
      </Button>
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => {
          setStep("email");
          setCode("");
          setError(null);
        }}
      >
        Use a different email
      </button>
      {error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </form>
  );
}

function SignIn({ siteKey }: { siteKey: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const ready = siteKey === null || token !== null;

  const googleSignIn = (): void => {
    if (!ready) {
      return;
    }
    window.location.href =
      token === null
        ? "/auth/login"
        : `/auth/login?cf-turnstile-response=${encodeURIComponent(token)}`;
  };

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      {siteKey !== null ? (
        <TurnstileWidget siteKey={siteKey} onToken={setToken} />
      ) : null}
      <Button
        size="lg"
        className="w-full"
        onClick={googleSignIn}
        disabled={!ready}
      >
        Sign in with Google
      </Button>
      <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <EmailForm token={token} ready={ready} />
    </div>
  );
}

function SignInCta() {
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

  if (siteKey === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return <SignIn siteKey={siteKey} />;
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-sm bg-[#ff6600] text-sm font-bold leading-none text-white">
        J
      </span>
      <span className="text-lg font-bold tracking-tight">news</span>
    </div>
  );
}

const steps = [
  {
    title: "Sign in with Google",
    body: "One click. Your account, your feed — nothing to configure.",
  },
  {
    title: "Describe what you want to read",
    body: "Plain text, in your own words. No tags, no rules, no filters to wire up.",
  },
  {
    title: "Get your front page",
    body: "AI reads the Hacker News front page and keeps only what matches — on demand and every morning.",
  },
];

const telegramCommands = ["/daily_time 08:30", "/fetch", "/set_preferences"];

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto w-full max-w-2xl px-6 pt-8">
        <BrandMark />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
        <section className="flex flex-col items-center pt-20 pb-16 text-center sm:pt-28">
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Hacker News, filtered to what you care about.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
            A public, AI-curated Hacker News front page. Sign in, tell it what
            you{"’"}re into, and get your own feed — without the noise.
          </p>
          <div className="mt-8">
            <SignInCta />
          </div>
        </section>

        <section className="border-t border-border py-14">
          <ol className="grid gap-10 sm:grid-cols-3 sm:gap-6">
            {steps.map((step, index) => (
              <li key={step.title} className="flex flex-col">
                <span className="text-sm font-semibold text-[#ff6600]">
                  {index + 1}
                </span>
                <h2 className="mt-2 font-semibold">{step.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="font-semibold">
            Delivered to Telegram, on your schedule
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Link a Telegram chat and the bot sends your picks automatically — up
            to three times a day, at the times and timezone you choose. It
            re-reads the front page for each delivery, so every message is
            fresh. Set your interests, change your slots, or pull a digest on
            demand, all from chat.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {telegramCommands.map((command) => (
              <li
                key={command}
                className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
              >
                {command}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-2xl px-6 py-8 text-sm text-muted-foreground">
        Curated by AI from the public Hacker News front page.
      </footer>
    </div>
  );
}
