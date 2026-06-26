import { authConfigSchema } from "@shared/api";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

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
    <div className="flex flex-col items-center gap-3">
      <div ref={ref} />
      <Button size="lg" onClick={signIn} disabled={token === null}>
        Sign in with Google
      </Button>
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
  if (siteKey === null) {
    return (
      <Button
        size="lg"
        onClick={() => {
          window.location.href = "/auth/login";
        }}
      >
        Sign in with Google
      </Button>
    );
  }
  return <TurnstileGate siteKey={siteKey} />;
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
