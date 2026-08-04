import { Dialog } from "@base-ui/react/dialog";
import { feedSourceItemListSchema, type FeedSourceItem } from "@shared/api";
import { Button } from "@/components/ui/button";
import { useCachedFetch } from "@/hooks/useCachedFetch";

function ItemList({ items }: { items: FeedSourceItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.id} className="truncate">
          {item.title}
        </li>
      ))}
    </ul>
  );
}

// Drill-down for one source: everything it ever contributed, and which of those
// the AI picked. Mounted only while open, so the fetch follows the click.
export function SourceItemsDialog({
  title,
  itemsPath,
  onClose,
}: {
  title: string;
  itemsPath: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useCachedFetch(
    itemsPath,
    feedSourceItemListSchema,
  );
  const items = data?.items ?? [];
  const selected = items.filter((item) => item.selected);
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg outline-none">
          <Dialog.Title className="text-base font-semibold">
            {title}
          </Dialog.Title>
          {error !== null ? (
            <p className="text-sm text-destructive">
              Could not load this source&apos;s items.
            </p>
          ) : loading && data === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">
                  Selected ({selected.length})
                </h3>
                <ItemList items={selected} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">
                  Fetched ({items.length})
                </h3>
                <ItemList items={items} />
              </section>
            </>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
