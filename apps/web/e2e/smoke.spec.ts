import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * The app's journeys, end to end, on the saved documents of the test channel
 * (built with too few videos, so its audiences are a preview). Each screen's
 * screenshot is saved in Playwright's output folder (test-results/). The
 * video page embeds the real YouTube player, so that test needs YouTube.
 */

async function check(page: Page, name: string, info: TestInfo) {
  // Nothing may be wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} is wider than the screen`).toBe(0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

/** The player reports its time within a second of `seconds` (a seek can land on a keyframe). */
async function playerNear(player: Locator, seconds: number) {
  await expect
    .poll(async () => Math.abs(Number(await player.getAttribute("data-current-time")) - seconds))
    .toBeLessThan(1);
}

test("from the landing page to an audience's effects", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Run a soundcheck before you publish",
  );
  await expect(page.getByText("Fixture data")).toBeVisible();
  await check(page, "landing", info);

  // The hero's button; the closing band has the same one.
  await page.getByRole("link", { name: "Open your channel" }).first().click();
  await expect(page).toHaveURL(/\/app\/building$/);
  await expect(page.getByRole("heading", { name: "Not enough videos yet" })).toBeVisible();
  await expect(page.getByText(/Your channel has 3 of 3 eligible videos/)).toBeVisible();
  await check(page, "building", info);

  await page.getByRole("link", { name: "See the preview anyway" }).click();
  await expect(page).toHaveURL(/\/app\/audiences$/);
  await expect(page.getByRole("note")).toContainText("Not a result yet");
  await expect(page.getByRole("heading", { name: "Subscribers" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Newcomers" })).toBeVisible();
  await expect(page.getByText("Not measured")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/cohort/i);
  await check(page, "audiences", info);

  await page.getByRole("button", { name: "See what keeps them watching" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Subscribers: what keeps them watching" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Nothing clear yet.")).toBeVisible();
  await expect(sheet.getByRole("heading", { name: /^No clear effect yet/ })).toBeVisible();
  await check(page, "sheet", info);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("link", { name: "Channel" }).click();
  await expect(page.getByRole("button", { name: "Disconnect and delete data" })).toBeVisible();
  await check(page, "channel", info);
});

test("from the videos list to why a drop-off happened", async ({ page }, info) => {
  await page.goto("/app/videos");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Videos");
  await check(page, "videos", info);

  await page.getByRole("link", { name: /Because she will always be our side/ }).click();
  await expect(page).toHaveURL(/\/app\/videos\/lgxOjPdCGkw$/);
  const panel = page.getByRole("region", { name: /^Why / });
  // It opens on the largest drop-off, and says why in words and chips.
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
    "Why 41.9% of newcomers left at 0:03",
  );
  await expect(panel).toContainText(
    "The model links 13% of this drop to its position in the video and 3% to waiting for the payoff. It can't explain the other 84%.",
  );
  await page.getByRole("button", { name: 'What "Position in video" means' }).click();
  await expect(page.getByRole("dialog")).toContainText("Viewers leave faster at the start");
  await page.keyboard.press("Escape");
  await expect(page.locator("main")).not.toContainText(/cohort/i);

  // Clicking a drop-off selects it and moves the real player there.
  const player = page.locator("[data-current-time]");
  await expect(player).toBeAttached({ timeout: 30_000 });
  await page.locator('[data-drop="subscribed:16"]').click();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
    "Why 11.1% of subscribers left at 0:39",
  );
  await playerNear(player, 39.3);
  await check(page, "video", info);

  // The arrow keys step back through the drop-offs, by time.
  await page.getByRole("group", { name: /arrow keys move between drop-offs/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
    "Why 6.2% of newcomers left at 0:26",
  );
  await playerNear(player, 26.2);
  await page.keyboard.press("ArrowLeft");

  // A cause links to its effect on the audiences screen.
  await panel
    .getByRole("link", {
      name: "Waiting for the payoff 3% (see this effect on the audiences screen)",
    })
    .click();
  await expect(page).toHaveURL(/\/app\/audiences\?audience=unsubscribed&effect=beat_payoff$/);
  const sheet = page.getByRole("dialog", { name: "Newcomers: what keeps them watching" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[aria-current="true"]')).toHaveText("Payoff moments");
  await check(page, "linked-effect", info);
});
