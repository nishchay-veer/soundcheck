import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The first two experiences, end to end, on the saved documents of the test
 * channel (built with too few videos, so its audiences are a preview). Each
 * screen's screenshot is saved in Playwright's output folder (test-results/).
 */

async function check(page: Page, name: string, info: TestInfo) {
  // Nothing may be wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} is wider than the screen`).toBe(0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

test("from the landing page to an audience's effects", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Run a soundcheck before you publish",
  );
  await expect(page.getByText("Fixture data")).toBeVisible();
  await check(page, "landing", info);

  await page.getByRole("link", { name: "Open your channel" }).click();
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

  await page
    .getByRole("button", { name: /See every effect/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Subscribers: every effect" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Can't tell yet").first()).toBeVisible();
  await check(page, "sheet", info);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("link", { name: "Channel" }).click();
  await expect(page.getByRole("button", { name: "Disconnect and delete data" })).toBeVisible();
  await check(page, "channel", info);
});
