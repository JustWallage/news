import { okSchema, preferencesSchema } from "@shared/api";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/AuthGate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { apiFetch, jsonInit } from "@/lib/api";

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
    </div>
  );
}
