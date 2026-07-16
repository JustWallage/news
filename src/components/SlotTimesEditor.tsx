import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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

// The three daily-digest time inputs, shared by the Telegram section (HN feed)
// and each user feed's settings. Parents own the state, dirty-guard, and save.
export function SlotTimesEditor({
  slots,
  onChange,
}: {
  slots: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Times</Label>
      <div className="space-y-2">
        {slots.map((value, i) => {
          const slotLabel = SLOT_LABELS[i] ?? `Slot ${i + 1}`;
          const name = `${slotLabel} daily summary time`;
          const isSet = value !== "";
          return (
            <div key={name} className="flex items-center gap-3">
              <span className="w-16 text-muted-foreground">{slotLabel}</span>
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
                  onChange(
                    slots.map((slot, j) =>
                      j === i ? event.target.value : slot,
                    ),
                  );
                }}
              />
              {isSet ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Clear ${name}`}
                  onClick={() => {
                    onChange(slots.map((slot, j) => (j === i ? "" : slot)));
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
  );
}
