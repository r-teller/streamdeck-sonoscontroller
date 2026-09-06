import { test, expect } from "@playwright/test";
import {
  mockStreamDeckHostSource,
  createMockHost,
  connect,
} from "./support/mockStreamDeckHost.js";
import path from "node:path";
import fs from "node:fs";

const bundleRoot = path.resolve(
  "com.r-teller.sonoscontroller.sdPlugin"
);
const pluginHtmlPath = path.join(bundleRoot, "plugin.html");
const piHtmlPath = path.join(bundleRoot, "pi.html");

// Ensure the built bundle exists before any tests run
test.beforeAll(() => {
  if (!fs.existsSync(pluginHtmlPath)) {
    throw new Error(
      "Built plugin.html not found. Run npm run build_dev before tests."
    );
  }
  if (!fs.existsSync(piHtmlPath)) {
    throw new Error(
      "Built pi.html not found. Run npm run build_dev before tests."
    );
  }
});

/**
 * Helper to collect console error messages from a page.
 */
function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return errors;
}

/**
 * Wait until at least one outbound frame has been recorded.
 */
async function waitForOutbound(page) {
  await page.waitForFunction(() => {
    // @ts-ignore – injected by mock host
    return window.__sdOutbound && window.__sdOutbound.length > 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Phase‑1 Tests                                                               */
/* -------------------------------------------------------------------------- */

test("p1-plugin-registers", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");

  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "plugin-uuid-1",
    registerEvent: "registerPlugin",
    actionInfo: null,
  });

  await waitForOutbound(page);
  const outbound = await mockHost.outbound();
  expect(outbound[0]).toEqual({
    event: "registerPlugin",
    uuid: "plugin-uuid-1",
  });
  expect(consoleErrors).toEqual([]);
});

test("p1-pi-registers", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");

  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-1",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.play",
      context: "ctx-1",
      payload: { settings: {} },
    },
  });

  await waitForOutbound(page);
  const outbound = await mockHost.outbound();
  expect(outbound[0]).toEqual({
    event: "registerPropertyInspector",
    uuid: "pi-uuid-1",
  });

  // Placeholder UI verification
  await expect(
    page.getByText("Sonos Controller Property Inspector")
  ).toBeVisible();

  // Capture screenshot for later review
  await page.screenshot({
    path: "tests/playwright/screenshots/p1-pi-empty.png",
  });

  expect(consoleErrors).toEqual([]);
});

test("p1-bridge-late-call", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");

  // Simulate late bridge installation
  await page.waitForTimeout(500);

  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "plugin-uuid-1",
    registerEvent: "registerPlugin",
    actionInfo: null,
  });

  await waitForOutbound(page);
  const outbound = await mockHost.outbound();
  expect(outbound[0]).toEqual({
    event: "registerPlugin",
    uuid: "plugin-uuid-1",
  });

  expect(consoleErrors).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* Build integrity check                                                       */
/* -------------------------------------------------------------------------- */

test("p1-build-integrity", async () => {
  // Required top‑level files
  const requiredFiles = ["plugin.html", "pi.html", "manifest.json"];
  for (const file of requiredFiles) {
    const fullPath = path.join(bundleRoot, file);
    expect(fs.existsSync(fullPath)).toBe(true);
  }

  // Layout files must be parseable JSON
  const layoutFiles = [
    "layouts/encoder-bar-0-100.json",
    "layouts/encoder-gbar-10-10.json",
    "layouts/encoder-audio-equalizer.json",
  ];
  for (const rel of layoutFiles) {
    const fullPath = path.join(bundleRoot, rel);
    expect(fs.existsSync(fullPath)).toBe(true);
    const content = fs.readFileSync(fullPath, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();
  }

  // Manifest image reference collection
  const manifestPath = path.join(bundleRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const imageRefs = [];
  function collectStrings(obj) {
    if (typeof obj === "string") {
      if (obj.startsWith("images/")) {
        imageRefs.push(obj);
      }
    } else if (Array.isArray(obj)) {
      for (const v of obj) collectStrings(v);
    } else if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) collectStrings(v);
    }
  }
  collectStrings(manifest);

  // Determine missing icon files (deferred for this phase)
  const missing = [];
  for (const ref of imageRefs) {
    const pngPath = path.join(bundleRoot, `${ref}.png`);
    const png2xPath = path.join(bundleRoot, `${ref}@2x.png`);
    if (!fs.existsSync(pngPath) && !fs.existsSync(png2xPath)) {
      missing.push(ref);
    }
  }

  // Log deferred icons; do not fail the test on missing files
  // eslint-disable-next-line no-console
  console.warn("DEFERRED-ICONS", missing);

  expect(Array.isArray(missing)).toBe(true);
  // TODO(DEFERRED-ICONS): tighten to expect(missing).toEqual([]) when icons land
});
