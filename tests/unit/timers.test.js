import { expect, test } from "vitest";
import { extractBody } from "@/modules/common/timers.js";

test("extractBody returns function body without wrapper", () => {
  function sample(a, b) {
    const sum = a + b;
    return sum;
  }
  const body = extractBody(sample);
  expect(body).toContain("const sum = a + b;");
  expect(body).toContain("return sum;");
  // No surrounding braces
  expect(body.startsWith("{")).toBe(false);
  expect(body.endsWith("}")).toBe(false);
});

test("importing timers does not override global timers in Node", () => {
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  // Import the module (already compiled, but re‑import to be safe)
  // eslint-disable-next-line import/no-unresolved
  import("@/modules/common/timers.js");
  expect(global.setTimeout).toBe(originalSetTimeout);
  expect(global.setInterval).toBe(originalSetInterval);
});
