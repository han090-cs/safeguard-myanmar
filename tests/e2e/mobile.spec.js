import { test, expect } from "@playwright/test";
import axe from "axe-core";
const axeSource = axe.source;

// The app ships a strict CSP (script-src self), so the test-only axe script must be injected with CSP bypass.
test.use({ bypassCSP: true });

test("mobile layout has no horizontal overflow and passes axe checks", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  // The project has no third-party runtime dependency for accessibility testing;
  // CI loads axe only for the test and does not ship it in the app bundle.
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }
  }));
  expect(results.violations).toEqual([]);
});
