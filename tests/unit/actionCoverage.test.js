/**
 * Coverage guard (sonos-8px.3): every dial action in public/manifest.json must be driven by a
 * Playwright test for each event it registers in actionFunctionMap. See docs/adding-actions.md.
 *
 * Static check of the spec sources, per `test(...)` block. A block counts for an action when it calls
 *   willAppear(<ctx>, <action>, <settings>, "Encoder")
 * directly, where <action> is the short name or full UUID as a string literal, or a file-level
 * `const X = "...<short-name>"`. The block then covers every `inject.<event>(` it contains.
 * Spec authors: keep the willAppear call and the injects in the test body, not in a shared helper,
 * or this guard cannot see them.
 *
 * Limits: it proves each event is sent to the dial somewhere, not that its effect is asserted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { actionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { registerSonosActions } from "@/modules/actions/sonosActions.js";

registerSonosActions();

const DIAL_EVENTS = ["dialRotate", "dialDown", "touchTap"];
const SPEC_DIR = resolve(process.cwd(), "tests/playwright");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split a spec into its `test(...)` blocks (text from one test( to the next). */
function testBlocks(source) {
  const starts = [...source.matchAll(/^[ \t]*test(?:\.(?:only|skip|fixme))?\(\s*["'`]/gm)].map((m) => m.index);
  return starts.map((start, i) => source.slice(start, starts[i + 1] ?? source.length));
}

/** Events a spec source injects into a dial of `shortName` that it made appear as an Encoder. */
function coveredEvents(source, shortName) {
  const aliases = [`["'\`][\\w.-]*${escapeRe(shortName)}["'\`]`];
  const constRe = new RegExp(`const\\s+(\\w+)\\s*=\\s*["'\`][\\w.-]*${escapeRe(shortName)}["'\`]`, "g");
  for (const m of source.matchAll(constRe)) aliases.push(`\\b${m[1]}\\b`);
  const appears = new RegExp(`willAppear\\([^;]*?(?:${aliases.join("|")})[^;]*?["']Encoder["']`, "s");

  const covered = new Set();
  for (const block of testBlocks(source)) {
    if (!appears.test(block)) continue;
    for (const event of DIAL_EVENTS) {
      if (new RegExp(`inject\\.${event}\\(`).test(block)) covered.add(event);
    }
  }
  return covered;
}

function specSources() {
  return readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith(".spec.js"))
    .map((f) => readFileSync(join(SPEC_DIR, f), "utf8"));
}

function coverageFor(shortName, sources = specSources()) {
  const covered = new Set();
  for (const source of sources) for (const e of coveredEvents(source, shortName)) covered.add(e);
  return covered;
}

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8"));
const dialActions = manifest.Actions.filter((a) => (a.Controllers ?? []).includes("Encoder")).map((a) =>
  a.UUID.split(".").pop(),
);

describe("action coverage guard", () => {
  it("finds the dial actions in the manifest", () => {
    expect(dialActions).toContain("encoder-audio-equalizer");
  });

  it.each(dialActions)("%s: registered in actionFunctionMap with an encoder state function", (shortName) => {
    expect(actionFunctionMap[shortName], `${shortName} is in the manifest but not in ACTION_NAMES`).toBeDefined();
    expect(typeof actionFunctionMap[shortName].state.encoder).toBe("function");
  });

  it.each(dialActions)("%s: registers at least one dial event", (shortName) => {
    // Guards against the coverage check below passing vacuously.
    const registered = DIAL_EVENTS.filter((e) => (actionFunctionMap[shortName]?.[e] ?? []).length > 0);
    expect(registered.length, `${shortName} registers no dialRotate/dialDown/touchTap handler`).toBeGreaterThan(0);
  });

  it.each(dialActions)("%s: every registered dial event is driven by a Playwright test", (shortName) => {
    const registered = DIAL_EVENTS.filter((e) => (actionFunctionMap[shortName]?.[e] ?? []).length > 0);
    const covered = coverageFor(shortName);
    const missing = registered.filter((e) => !covered.has(e));
    expect(
      missing,
      `${shortName}: no Playwright test makes it appear as "Encoder" and injects ${missing.join(", ")} (docs/adding-actions.md)`,
    ).toEqual([]);
  });

  it("the scanner attributes injects to the test block that made the dial appear", () => {
    const spec = `
const DIAL = "com.x.my-dial";
test("a", async () => {
  await mockHost.inject.willAppear(
    "c1",
    DIAL,
    { uuid: "u" },
    "Encoder",
  );
  await mockHost.inject.dialRotate("c1", 1);
});
test("b", async () => {
  await mockHost.inject.willAppear("c2", "other-dial", {}, "Encoder");
  await mockHost.inject.touchTap("c2");
});
test("c", async () => {
  await mockHost.inject.willAppear("c3", "my-dial", {});
  await mockHost.inject.dialDown("c3");
});
`;
    expect([...coveredEvents(spec, "my-dial")]).toEqual(["dialRotate"]); // b is another dial, c is a key
    expect([...coveredEvents(spec, "other-dial")]).toEqual(["touchTap"]);
  });
});
