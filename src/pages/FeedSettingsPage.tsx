import {
  FEED_TITLE_MAX_LENGTH,
  feedDetailSchema,
  feedSourceSchema,
  okSchema,
} from "@shared/api";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SlotTimesEditor } from "@/components/SlotTimesEditor";
import { SourceItemsDialog } from "@/components/SourceItemsDialog";
import { Button } from "@/components/ui/button";
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
import { ApiRequestError, apiFetch, jsonInit } from "@/lib/api";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function StatusNote({ status }: { status: SaveStatus }) {
  if (status === "saved") {
    return <span className="text-muted-foreground">Saved.</span>;
  }
  if (status === "error") {
    return <span className="text-destructive">Could not save.</span>;
  }
  return null;
}

export function FeedSettingsPage() {
  const params = useParams();
  const feedId = Number(params.feedId);
  const path = `/api/feeds/${String(feedId)}`;
  const { data, error, mutate } = useCachedFetch(path, feedDetailSchema);
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [prefs, setPrefs] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const detailsDirty = useRef(false);

  const [sourceUrl, setSourceUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [slotStatus, setSlotStatus] = useState<SaveStatus>("idle");
  const slotsDirty = useRef(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openSourceId, setOpenSourceId] = useState<number | null>(null);
  const [removeSourceId, setRemoveSourceId] = useState<number | null>(null);

  // Seed the editors from the server only while pristine, so a background
  // revalidate can never clobber what the user is typing.
  useEffect(() => {
    if (data !== undefined && !detailsDirty.current) {
      setTitle(data.title);
      setPrefs(data.preferencesText);
    }
  }, [data]);
  useEffect(() => {
    if (data !== undefined && !slotsDirty.current) {
      setSlots(data.slots.map((slot) => slot ?? ""));
    }
  }, [data]);

  if (!Number.isInteger(feedId) || feedId <= 0 || error !== null) {
    return <p className="text-sm text-destructive">Unknown feed.</p>;
  }

  const save = (): void => {
    setSaveStatus("saving");
    apiFetch(path, okSchema, jsonInit("PUT", { title, preferencesText: prefs }))
      .then(() => {
        setSaveStatus("saved");
        detailsDirty.current = false;
        mutate();
      })
      .catch(() => {
        setSaveStatus("error");
      });
  };

  const addSource = (): void => {
    if (sourceUrl.trim() === "") {
      return;
    }
    setAdding(true);
    setSourceError(null);
    apiFetch(
      `${path}/sources`,
      feedSourceSchema,
      jsonInit("POST", { url: sourceUrl.trim() }),
    )
      .then(() => {
        setSourceUrl("");
        mutate();
      })
      .catch((cause: unknown) => {
        setSourceError(
          cause instanceof ApiRequestError
            ? cause.message
            : "Could not add that source.",
        );
      })
      .finally(() => {
        setAdding(false);
      });
  };

  const removeSource = (sourceId: number): void => {
    apiFetch(`${path}/sources/${String(sourceId)}`, okSchema, {
      method: "DELETE",
    })
      .then(() => {
        mutate();
      })
      .catch(() => {
        // Removal failed — the source stays listed; the user can retry.
      });
  };

  const saveSlots = (): void => {
    setSlotStatus("saving");
    const payload = { slots: slots.map((slot) => (slot === "" ? null : slot)) };
    apiFetch(`${path}/slots`, okSchema, jsonInit("PUT", payload))
      .then(() => {
        setSlotStatus("saved");
        slotsDirty.current = false;
        mutate();
      })
      .catch(() => {
        setSlotStatus("error");
      });
  };

  const remove = (): void => {
    setDeleting(true);
    apiFetch(path, okSchema, { method: "DELETE" })
      .then(() => {
        void navigate("/feeds");
      })
      .catch(() => {
        setDeleting(false);
      });
  };

  const sources = data?.sources ?? [];
  const openSource = sources.find((source) => source.id === openSourceId);
  const sourceToRemove = sources.find((source) => source.id === removeSourceId);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/feeds/${String(feedId)}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to feed
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Feed</CardTitle>
          <CardDescription>
            The title, and what this feed should pick for you — the AI matches
            item titles and links against it. Leave it empty to see everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="feed-title">Title</Label>
            <Input
              id="feed-title"
              value={title}
              maxLength={FEED_TITLE_MAX_LENGTH}
              className="max-w-xs"
              onChange={(event) => {
                detailsDirty.current = true;
                setTitle(event.target.value);
                setSaveStatus("idle");
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feed-preferences">Preferences</Label>
            <Textarea
              id="feed-preferences"
              value={prefs}
              rows={8}
              placeholder="e.g. TypeScript tooling deep dives, database internals. No release-notes posts."
              onChange={(event) => {
                detailsDirty.current = true;
                setPrefs(event.target.value);
                setSaveStatus("idle");
              }}
            />
          </div>
        </CardContent>
        <CardFooter className="gap-3">
          <Button
            onClick={save}
            disabled={saveStatus === "saving" || title.trim() === ""}
          >
            {saveStatus === "saving" ? "Saving…" : "Save"}
          </Button>
          <StatusNote status={saveStatus} />
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>
            RSS or Atom feeds this feed reads from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sources yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {sources.map((source) => (
                <Card key={source.id} size="sm">
                  <button
                    type="button"
                    className="w-full cursor-pointer text-left"
                    aria-label={`Items from ${source.title}`}
                    onClick={() => {
                      setOpenSourceId(source.id);
                    }}
                  >
                    <CardHeader>
                      <CardTitle className="truncate">{source.title}</CardTitle>
                      <CardDescription className="truncate text-xs">
                        {source.url}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {source.fetchedCount} fetched · {source.selectedCount}{" "}
                      selected
                    </CardContent>
                  </button>
                  <CardFooter>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${source.title}`}
                      onClick={() => {
                        setRemoveSourceId(source.id);
                      }}
                    >
                      Remove
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addSource();
            }}
          >
            <Input
              value={sourceUrl}
              aria-label="Source URL"
              placeholder="https://example.com/feed.xml"
              className="max-w-sm"
              onChange={(event) => {
                setSourceUrl(event.target.value);
                setSourceError(null);
              }}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={adding || sourceUrl.trim() === ""}
            >
              {adding ? "Checking…" : "Add source"}
            </Button>
          </form>
          {sourceError !== null && (
            <p className="text-sm text-destructive">{sourceError}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram digests</CardTitle>
          <CardDescription>
            Up to three times a day, this feed's new picks are sent to your
            connected chat — each item at most once.
          </CardDescription>
        </CardHeader>
        {data?.telegramLinked === true ? (
          <>
            <CardContent>
              <SlotTimesEditor
                slots={slots}
                onChange={(next) => {
                  slotsDirty.current = true;
                  setSlots(next);
                  setSlotStatus("idle");
                }}
              />
            </CardContent>
            <CardFooter className="gap-3">
              <Button onClick={saveSlots} disabled={slotStatus === "saving"}>
                {slotStatus === "saving" ? "Saving…" : "Save times"}
              </Button>
              <StatusNote status={slotStatus} />
            </CardFooter>
          </>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connect Telegram on the{" "}
              <Link to="/preferences" className="underline">
                preferences page
              </Link>{" "}
              first, then pick delivery times here.
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardFooter>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmDelete(true);
            }}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete feed"}
          </Button>
        </CardFooter>
      </Card>

      {openSource !== undefined && (
        <SourceItemsDialog
          title={openSource.title}
          itemsPath={`${path}/sources/${String(openSource.id)}/items`}
          onClose={() => {
            setOpenSourceId(null);
          }}
        />
      )}

      <ConfirmDialog
        open={sourceToRemove !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveSourceId(null);
          }
        }}
        title={`Remove ${sourceToRemove?.title ?? "this source"}?`}
        description="This feed stops fetching from it. Items it already contributed stay in the archive until the next refresh drops them from the feed."
        confirmLabel="Yes, remove"
        onConfirm={() => {
          if (sourceToRemove !== undefined) {
            removeSource(sourceToRemove.id);
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this feed?"
        description="Its sources, items, and archive are removed for good."
        confirmLabel="Yes, delete"
        onConfirm={remove}
      />
    </div>
  );
}
