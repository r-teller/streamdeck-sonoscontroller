// The screenshot preview (harness/key-preview.html) draws dials from the plugin's real layout files
// (sonos-8px.4), so screenshots show what the layouts actually define.
import { test, expect } from "@playwright/test";

const CTX = "ctx-preview";

async function render(page, frames) {
  await page.evaluate((f) => window.renderFrames(f), frames);
}

test.describe("preview harness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/harness/key-preview.html");
  });

  test("draws a dial from the real layout file", async ({ page }) => {
    const layout = await (await page.request.get("/layouts/encoder-bar-0-100.json")).json();
    await render(page, [
      { event: "setFeedbackLayout", context: CTX, payload: { layout: "./layouts/encoder-bar-0-100.json" } },
      { event: "setFeedback", context: CTX, payload: { title: "Volume", value: 45, indicator: 45 } },
    ]);
    const title = page.locator(".encoder-text", { hasText: "Volume" });
    const value = page.locator(".encoder-text", { hasText: "45" });
    const item = (key) => layout.items.find((i) => i.key === key);
    // Position, size and font come from the layout file, not a copy in the harness.
    await expect(title).toHaveCSS("left", `${item("title").rect[0]}px`);
    await expect(title).toHaveCSS("width", `${item("title").rect[2]}px`);
    await expect(value).toHaveCSS("font-size", `${item("value").font.size}px`);
    await expect(value).toHaveCSS("font-weight", String(item("value").font.weight));
    await expect(page.locator(".encoder-indicator-bar")).toHaveCSS("width", /px$/);
  });

  test("setFeedback is a partial update and draws pixmaps", async ({ page }) => {
    await render(page, [
      { event: "setFeedbackLayout", context: CTX, payload: { layout: "./layouts/encoder-bar-0-100.json" } },
      { event: "setFeedback", context: CTX, payload: { title: "Bass", value: -3, indicator: 7 } },
      { event: "setFeedback", context: CTX, payload: { value: 2, icon: "images/keys/equalizer.png" } },
    ]);
    // title kept from the first update, value replaced by the second
    await expect(page.locator(".encoder-text", { hasText: "Bass" })).toHaveCount(1);
    await expect(page.locator(".encoder-text", { hasText: /^2$/ })).toHaveCount(1);
    const icon = page.locator("img.encoder-pixmap");
    await expect(icon).toHaveAttribute("src", "/images/keys/equalizer.png");
    expect(await icon.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test("showAlert marks the dial until the next feedback", async ({ page }) => {
    await render(page, [
      { event: "setFeedbackLayout", context: CTX, payload: { layout: "./layouts/encoder-bar-0-100.json" } },
      { event: "setFeedback", context: CTX, payload: { title: "Volume", value: 10, indicator: 10 } },
      { event: "showAlert", context: CTX, payload: {} },
    ]);
    const alert = page.locator(".encoder-tile .tile-alert, .tile .tile-alert").last();
    await expect(alert).toBeVisible();
    await render(page, [
      { event: "setFeedbackLayout", context: CTX, payload: { layout: "./layouts/encoder-bar-0-100.json" } },
      { event: "setFeedback", context: CTX, payload: { title: "Volume", value: 10, indicator: 10 } },
      { event: "showAlert", context: CTX, payload: {} },
      { event: "setFeedback", context: CTX, payload: { value: 11, indicator: 11 } },
    ]);
    await expect(alert).toBeHidden();
  });

  test("text is cut at the item's rect, not wrapped", async ({ page }) => {
    await render(page, [
      { event: "setFeedbackLayout", context: CTX, payload: { layout: "./layouts/encoder-bar-0-100.json" } },
      { event: "setFeedback", context: CTX, payload: { title: "A very long title that cannot fit on the strip" } },
    ]);
    const title = page.locator(".encoder-text").first();
    await expect(title).toHaveCSS("white-space", "nowrap");
    await expect(title).toHaveCSS("overflow", "hidden");
    const box = await title.boundingBox();
    expect(box.height).toBeLessThanOrEqual(24);
  });

  test("an unknown layout draws nothing instead of failing", async ({ page }) => {
    await render(page, [
      { event: "setFeedbackLayout", context: CTX, payload: { layout: "./layouts/does-not-exist.json" } },
      { event: "setFeedback", context: CTX, payload: { title: "x" } },
    ]);
    await expect(page.locator(".encoder-text")).toHaveCount(0);
  });
});
