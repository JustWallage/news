import {
  okSchema,
  preferencesSchema,
  telegramLinkCodeSchema,
  telegramStatusSchema,
  type TelegramLinkCode,
} from "@shared/api";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/AuthGate";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch, jsonInit } from "@/lib/api";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

async function logout(): Promise<void> {
  await apiFetch("/auth/logout", okSchema, jsonInit("POST", {}));
  window.location.href = "/";
}

const SLOT_LABELS = ["First", "Second", "Third"];

function TelegramSection() {
  const { data, mutate } = useCachedFetch(
    "/api/telegram",
    telegramStatusSchema,
  );
  const [code, setCode] = useState<TelegramLinkCode | null>(null);
  const [pending, setPending] = useState(false);
  const [test, setTest] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [copied, setCopied] = useState(false);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [slotStatus, setSlotStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Seed from the server only while untouched, so a background revalidate can
  // never clobber an in-flight choice (same guard as the interests textarea).
  const tzDirty = useRef(false);
  const slotsDirty = useRef(false);

  useEffect(() => {
    if (data?.timezone != null && !tzDirty.current) {
      setTimezone(data.timezone);
    }
  }, [data]);

  useEffect(() => {
    if (data !== undefined && !slotsDirty.current) {
      setSlots(data.slots.map((slot) => slot ?? ""));
    }
  }, [data]);

  const changeTimezone = (next: string): void => {
    tzDirty.current = true;
    setTimezone(next);
    apiFetch(
      "/api/telegram/timezone",
      okSchema,
      jsonInit("PUT", { timezone: next }),
    )
      .then(() => {
        mutate();
      })
      .catch(() => {
        // Leave the selector on the chosen value; a later save can retry.
      });
  };

  const saveSlots = (): void => {
    setSlotStatus("saving");
    const payload = { slots: slots.map((slot) => (slot === "" ? null : slot)) };
    apiFetch("/api/telegram/slots", okSchema, jsonInit("PUT", payload))
      .then(() => {
        setSlotStatus("saved");
        slotsDirty.current = false;
        mutate();
      })
      .catch(() => {
        setSlotStatus("error");
      });
  };

  const disconnect = (): void => {
    setDisconnecting(true);
    apiFetch("/api/telegram", okSchema, { method: "DELETE" })
      .then(() => {
        setCode(null);
        setSlots(["", "", ""]);
        slotsDirty.current = false;
        setTest("idle");
        mutate();
      })
      .catch(() => {
        // Disconnect failed — the chat stays linked; the user can retry.
      })
      .finally(() => {
        setDisconnecting(false);
      });
  };

  const connect = (): void => {
    setPending(true);
    apiFetch(
      "/api/telegram/link-code",
      telegramLinkCodeSchema,
      jsonInit("POST", { timezone }),
    )
      .then((next) => {
        setCode(next);
        setCopied(false);
      })
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

  const copy = (): void => {
    if (code === null) {
      return;
    }
    navigator.clipboard
      .writeText(`/start ${code.code}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => {
        // Clipboard denied — leave the button showing "Copy".
      });
  };

  const linked = data?.linked === true;
  const label = data?.chatLabel ?? null;
  const who = label === null ? "Connected." : `Connected as ${label}.`;

  return (
    <div className="space-y-4 border-t pt-5">
      <div className="space-y-1">
        <Label>Telegram</Label>
        <p className="text-sm text-muted-foreground">
          Get your daily news summaries in Telegram.
        </p>
      </div>

      {linked && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{who}</p>
          <div className="space-y-2">
            <Label>Daily summary times</Label>
            <p className="text-sm text-muted-foreground">
              Up to three times a day (Europe/Amsterdam). Leave a slot empty to
              skip it.
            </p>
            <div className="flex flex-wrap gap-2">
              {slots.map((value, i) => (
                <Input
                  key={SLOT_LABELS[i]}
                  type="time"
                  step={300}
                  value={value}
                  aria-label={`${SLOT_LABELS[i]} daily summary time`}
                  className="w-32"
                  onChange={(event) => {
                    slotsDirty.current = true;
                    setSlots(
                      slots.map((slot, j) =>
                        j === i ? event.target.value : slot,
                      ),
                    );
                    setSlotStatus("idle");
                  }}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={saveSlots} disabled={slotStatus === "saving"}>
                {slotStatus === "saving" ? "Saving…" : "Save times"}
              </Button>
              {slotStatus === "saved" && (
                <span className="text-sm text-muted-foreground">Saved.</span>
              )}
              {slotStatus === "error" && (
                <span className="text-sm text-destructive">
                  Could not save.
                </span>
              )}
            </div>
          </div>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmDisconnect(true);
            }}
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Telegram?"
        description="This chat will stop receiving daily summaries and your saved times will be cleared. You can reconnect any time."
        confirmLabel="Yes, disconnect"
        onConfirm={disconnect}
      />

      <div className="space-y-1">
        <Label htmlFor="timezone">Timezone</Label>
        <p className="text-sm text-muted-foreground">
          Your daily summaries are scheduled in this timezone.
        </p>
        <select
          id="timezone"
          value={timezone}
          onChange={(event) => {
            changeTimezone(event.target.value);
          }}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Generate your start command below.</li>
        <li>Copy it and open the bot.</li>
        <li>Send the command to the bot to connect.</li>
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={connect} disabled={pending}>
          {pending
            ? "Generating…"
            : code === null
              ? "Generate start command"
              : "Regenerate"}
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
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-sm">
              /start {code.code}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Send this to the bot to connect. This code expires in 15 minutes.
          </p>
          {code.url !== null && (
            <a
              href={code.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ size: "lg" })}
            >
              Open the bot
            </a>
          )}
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void logout();
          }}
        >
          Log out
        </Button>
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
