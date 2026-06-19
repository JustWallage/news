import {
  okSchema,
  preferencesSchema,
  telegramLinkCodeSchema,
  telegramStatusSchema,
  type TelegramLinkCode,
} from "@shared/api";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/AuthGate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch, jsonInit } from "@/lib/api";

function TelegramSection() {
  const { data } = useCachedFetch("/api/telegram", telegramStatusSchema);
  const [code, setCode] = useState<TelegramLinkCode | null>(null);
  const [pending, setPending] = useState(false);
  const [test, setTest] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  const connect = (): void => {
    setPending(true);
    apiFetch(
      "/api/telegram/link-code",
      telegramLinkCodeSchema,
      jsonInit("POST", {}),
    )
      .then(setCode)
      .catch(() => {
        setCode(null);
      })
      .finally(() => {
        setPending(false);
      });
  };

  const sendTest = (): void => {
    setTest("sending");
    apiFetch("/api/telegram/test", okSchema, jsonInit("POST", {}))
      .then(() => {
        setTest("sent");
      })
      .catch(() => {
        setTest("error");
      });
  };

  const linked = data?.linked === true;
  const label = data?.chatLabel ?? null;
  const slots = data?.slots.filter((s): s is string => s !== null) ?? [];

  let statusText: string;
  if (!linked) {
    statusText =
      "Get your summaries in Telegram. Generate a code, then send the bot /start <code>.";
  } else {
    const who = label === null ? "Connected." : `Connected as ${label}.`;
    const when =
      slots.length > 0
        ? ` Daily summaries at ${slots.join(", ")}.`
        : " Set summary times in the bot with /daily-time.";
    statusText = who + when;
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <Label>Telegram</Label>
      <p className="text-sm text-muted-foreground">{statusText}</p>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={connect} disabled={pending}>
          {linked ? "Reconnect Telegram" : "Connect Telegram"}
        </Button>
        {linked && (
          <Button
            variant="outline"
            onClick={sendTest}
            disabled={test === "sending"}
          >
            {test === "sending" ? "Sending…" : "Send test message"}
          </Button>
        )}
        {test === "sent" && (
          <span className="text-sm text-muted-foreground">Sent.</span>
        )}
        {test === "error" && (
          <span className="text-sm text-destructive">Could not send.</span>
        )}
      </div>
      {code !== null && (
        <div className="space-y-1 text-sm">
          <p>
            Send the bot{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              /start {code.code}
            </code>
            {code.url !== null && (
              <>
                {" "}
                or{" "}
                <a className="underline" href={code.url}>
                  open the bot
                </a>
              </>
            )}
            .
          </p>
          <p className="text-muted-foreground">
            This code expires in 15 minutes.
          </p>
        </div>
      )}
    </div>
  );
}

export function PreferencesPage() {
  const email = useUser();
  const { data, mutate } = useCachedFetch(
    "/api/preferences",
    preferencesSchema,
  );
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  // Seed the field from the server only while it is still pristine, so a
  // background revalidate can never clobber what the user is typing.
  const dirty = useRef(false);

  useEffect(() => {
    if (data !== undefined && !dirty.current) {
      setText(data.text);
    }
  }, [data]);

  const save = (): void => {
    setStatus("saving");
    apiFetch("/api/preferences", okSchema, jsonInit("PUT", { text }))
      .then(() => {
        setStatus("saved");
        mutate();
      })
      .catch(() => {
        setStatus("error");
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{email}</span>
        <a
          href="/cdn-cgi/access/logout"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Log out
        </a>
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferences">Your interests</Label>
        <p className="text-sm text-muted-foreground">
          Describe what you want to read in plain text. The morning filter uses
          this to pick stories.
        </p>
        <Textarea
          id="preferences"
          value={text}
          onChange={(event) => {
            dirty.current = true;
            setText(event.target.value);
            setStatus("idle");
          }}
          rows={16}
          placeholder="e.g. Rust and systems programming, self-hosting, indie startups, LLM tooling. Not interested in crypto or politics."
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
        {status === "saved" && (
          <span className="text-sm text-muted-foreground">Saved.</span>
        )}
        {status === "error" && (
          <span className="text-sm text-destructive">Could not save.</span>
        )}
      </div>

      <TelegramSection />
    </div>
  );
}
