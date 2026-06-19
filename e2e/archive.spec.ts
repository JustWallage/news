import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

// Drives a story into the archive: a first digest curates it (current), a second
// digest with different preferences displaces it (current = false).
async function archiveRustStory(request: APIRequestContext) {
  await request.put("/api/preferences", { data: { text: "rust" } });
  await request.post("/api/digest/run");
  await request.put("/api/preferences", { data: { text: "bitcoin" } });
  await request.post("/api/digest/run");
}

test("the archive shows displaced posts, not the current feed", async ({
  page,
  request,
}) => {
  await archiveRustStory(request);

  await page.goto("/archive");
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Bitcoin hits a new all-time high/ }),
  ).toBeHidden();

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

  await page.reload();
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toHaveClass(/text-muted-foreground/);
});
