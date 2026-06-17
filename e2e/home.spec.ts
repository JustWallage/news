import { expect, test } from "./fixtures";

test("an empty feed shows guidance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/No stories yet/)).toBeVisible();
});

test("the Refresh button curates the feed from preferences", async ({
  page,
}) => {
  await page.goto("/preferences");
  await page.getByLabel("Your interests").fill("rust");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toBeVisible();
  await expect(page.getByText(/Bitcoin hits a new all-time high/)).toBeHidden();
});

test("curated stories render HN-style with working links", async ({
  page,
  request,
}) => {
  await request.put("/api/preferences", { data: { text: "rust" } });
  await request.post("/api/digest/run");

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toHaveAttribute("href", "https://example.com/rust");
  await expect(page.getByText(/412 points by alice/)).toBeVisible();
  await expect(page.getByRole("link", { name: "88 comments" })).toHaveAttribute(
    "href",
    /item\?id=1001/,
  );
});
