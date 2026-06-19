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

// The digest fetches 100 stories and caches them all (chunked upserts); with no
// preferences it then shows the top 30. Both the 100-row stories upsert and the
// 30-row curations upsert span several chunks against the real ephemeral D1 in
// CI, where the 100-bound-parameter limit is enforced — so an unchunked insert
// would fail this test before deploy.
test("Refresh with no preferences curates the front page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("ol > li")).toHaveCount(30);
});

test("opening a story greys its title at once, without a reload", async ({
  page,
  request,
}) => {
  await request.put("/api/preferences", { data: { text: "rust" } });
  await request.post("/api/digest/run");

  await page.goto("/");
  const link = page.getByRole("link", { name: /Rust's new borrow checker/ });
  await expect(link).not.toHaveClass(/text-muted-foreground/);

  const popup = page.context().waitForEvent("page");
  await link.click();
  await (await popup).close();

  await expect(link).toHaveClass(/text-muted-foreground/);
});

test("editing preferences re-evaluates a previously hidden story", async ({
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

  await page.goto("/preferences");
  await page.getByLabel("Your interests").fill("bitcoin");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByRole("link", { name: /Bitcoin hits a new all-time high/ }),
  ).toBeVisible();
});
