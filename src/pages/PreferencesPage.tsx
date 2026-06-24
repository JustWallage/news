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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch, jsonInit } from "@/lib/api";
import { cn } from "@/lib/utils";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

async function logout(): Promise<void> {
  await apiFetch("/auth/logout", okSchema, jsonInit("POST", {}));
  window.location.href = "/";
}

const SLOT_LABELS = ["First", "Second", "Third"];

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

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

  const email = useUser();
  const linked = data?.linked === true;
  const label = data?.chatLabel ?? null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>
            Get your daily news summaries in Telegram.
          </CardDescription>
        </CardHeader>

        {linked ? (
          <>
            <CardContent className="space-y-1">
              <p>
                Connected to Telegram
                {label !== null && (
                  <>
                    {" as "}
                    <span className="font-medium">{label}</span>
                  </>
                )}
                .
              </p>
              <p className="text-muted-foreground">
                Summaries for {email} are delivered to this chat.
              </p>
            </CardContent>
            <CardFooter className="gap-3">
              <Button
                variant="outline"
                onClick={sendTest}
                disabled={test === "sending"}
              >
                {test === "sending" ? "Sending…" : "Send test message"}
              </Button>
              {test === "sent" && (
                <span className="text-muted-foreground">Sent.</span>
              )}
              {test === "error" && (
                <span className="text-destructive">Could not send.</span>
              )}
              <Button
                variant="destructive"
                className="ml-auto"
                onClick={() => {
                  setConfirmDisconnect(true);
                }}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </CardFooter>
          </>
        ) : (
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              Generate a connect link, open it, and your account links
              automatically.
            </p>

            {code === null ? (
              <Button onClick={connect} disabled={pending}>
                {pending ? "Generating…" : "Generate connect link"}
              </Button>
            ) : (
              <div className="space-y-4">
                {code.url !== null && (
                  <div className="space-y-1.5">
                    <a
                      href={code.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        buttonVariants({ size: "lg" }),
                        "h-11 w-full text-base",
                      )}
                    >
                      Link my account
                    </a>
                    <p className="text-muted-foreground">
                      Opens Telegram and links your account automatically —
                      that's all you need.
                    </p>
                  </div>
                )}

                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm text-muted-foreground">
                    {code.url !== null
                      ? "Prefer to do it by hand? Send this command to the bot instead:"
                      : "Send this command to the bot to connect:"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-2 py-1 text-sm">
                      /start {code.code}
                    </code>
                    <Button variant="outline" size="sm" onClick={copy}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This code expires in 15 minutes.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={connect}
                    disabled={pending}
                  >
                    {pending ? "Generating…" : "Generate a new link"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {linked && (
        <Card>
          <CardHeader>
            <CardTitle>Daily summaries</CardTitle>
            <CardDescription>
              Up to three times a day, in your timezone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
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

            <div className="space-y-2">
              <Label>Times</Label>
              <div className="space-y-2">
                {slots.map((value, i) => {
                  const slotLabel = SLOT_LABELS[i] ?? `Slot ${i + 1}`;
                  const name = `${slotLabel} daily summary time`;
                  const isSet = value !== "";
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-16 text-muted-foreground">
                        {slotLabel}
                      </span>
                      <Input
                        type="time"
                        step={300}
                        value={value}
                        aria-label={name}
                        className={cn(
                          "w-32",
                          !isSet && "bg-muted/40 text-muted-foreground",
                        )}
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
                      {isSet ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Clear ${name}`}
                          onClick={() => {
                            slotsDirty.current = true;
                            setSlots(
                              slots.map((slot, j) => (j === i ? "" : slot)),
                            );
                            setSlotStatus("idle");
                          }}
                        >
                          <TrashIcon />
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
          <CardFooter className="gap-3">
            <Button onClick={saveSlots} disabled={slotStatus === "saving"}>
              {slotStatus === "saving" ? "Saving…" : "Save times"}
            </Button>
            {slotStatus === "saved" && (
              <span className="text-muted-foreground">Saved.</span>
            )}
            {slotStatus === "error" && (
              <span className="text-destructive">Could not save.</span>
            )}
          </CardFooter>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Telegram?"
        description="This chat will stop receiving daily summaries and your saved times will be cleared. You can reconnect any time."
        confirmLabel="Yes, disconnect"
        onConfirm={disconnect}
      />
    </>
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
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <CardTitle>Your interests</CardTitle>
          <CardDescription>
            Describe what you want to read in plain text. The morning filter
            uses this to pick stories.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="preferences"
            aria-label="Your interests"
            value={text}
            onChange={(event) => {
              dirty.current = true;
              setText(event.target.value);
              setStatus("idle");
            }}
            rows={14}
            placeholder="e.g. Rust and systems programming, self-hosting, indie startups, LLM tooling. Not interested in crypto or politics."
          />
        </CardContent>
        <CardFooter className="gap-3">
          <Button onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save"}
          </Button>
          {status === "saved" && (
            <span className="text-muted-foreground">Saved.</span>
          )}
          {status === "error" && (
            <span className="text-destructive">Could not save.</span>
          )}
        </CardFooter>
      </Card>

      <TelegramSection />
    </div>
  );
}
