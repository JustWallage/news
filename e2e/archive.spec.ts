import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

// Shows the Rust story first, then displaces it: a second digest under other
// preferences drops it from the current feed but not from the archive.
async function archiveRustStory(request: APIRequestContext) {
  await request.put("/api/preferences", { data: { text: "rust" } });
  await request.post("/api/digest/run");
  await request.put("/api/preferences", { data: { text: "bitcoin" } });
  await request.post("/api/digest/run");
}

test("the archive holds every story ever shown, most recently shown first", async ({
  page,
  request,
}) => {
  await archiveRustStory(request);

  await page.goto("/archive");
  // The current feed's story leads (shown by the newer run), the displaced one
  // follows — and a story the AI never picked is in neither.
  await expect(page.getByRole("listitem")).toHaveText([
    /Bitcoin hits a new all-time high/,
    /Rust's new borrow checker/,
  ]);

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Bitcoin hits a new all-time high/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toBeHidden();
});

test("an empty archive shows guidance", async ({ page }) => {
  await page.goto("/archive");
  await expect(page.getByText(/Nothing archived yet/)).toBeVisible();
});

test("opening an archived story marks it visited", async ({
  page,
  request,
}) => {
  await archiveRustStory(request);

  await page.goto("/archive");
  const open = page.waitForResponse(
    (r) => r.url().includes("/open") && r.request().method() === "POST",
  );
  await page.getByRole("link", { name: /Rust's new borrow checker/ }).click();
  await open;

  // Greys in place: the archive revalidates its own list, no reload needed.
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toHaveClass(/text-muted-foreground/);

  await page.reload();
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toHaveClass(/text-muted-foreground/);
});
