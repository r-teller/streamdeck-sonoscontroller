/**
 * Targets the build dir (com.r-teller.sonoscontroller.sdPlugin/) because CI runs unit tests before build;
 * all tests self-skip when the build output is absent. The packaged zip is spot-checked when present;
 * a full pack is exercised manually and in the release workflow.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const buildDir = resolve(repoRoot, "com.r-teller.sonoscontroller.sdPlugin");
const artifactPath = resolve(repoRoot, "com.r-teller.sonoscontroller.streamDeckPlugin");

// -----------------------------------------------------------------------------
// Helper: safely read JSON, throwing a clear error if parsing fails
function readJson(filePath) {
  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }
}

// -----------------------------------------------------------------------------
// Main test suite - skipped entirely if the build directory does not exist
describe.skipIf(!existsSync(buildDir))("package integrity", () => {
  // ---------------------------------------------------------------------------
  // 1. Manifest parses and basic fields are correct
  it("manifest parses", () => {
    const manifestPath = join(buildDir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = readJson(manifestPath);

    expect(manifest.UUID).toBe("com.r-teller.sonoscontroller");
    expect(manifest.CodePath).toBe("plugin.html");
    expect(Array.isArray(manifest.Actions)).toBe(true);
    expect(manifest.Actions.length).toBe(13);
  });

  // ---------------------------------------------------------------------------
  // 2. Every manifest-referenced image exists at 1x and @2x
  it("every manifest-referenced image exists at 1x and @2x", () => {
    const manifest = readJson(join(buildDir, "manifest.json"));
    const refs = new Set();

    // top-level icons
    if (manifest.Icon) refs.add(manifest.Icon);
    if (manifest.CategoryIcon) refs.add(manifest.CategoryIcon);

    // per-action icons and state images
    for (const action of manifest.Actions) {
      if (action.Icon) refs.add(action.Icon);
      if (Array.isArray(action.States)) {
        for (const state of action.States) {
          if (state.Image) refs.add(state.Image);
        }
      }
    }

    // sanity check - we expect a decent number of refs
    expect(refs.size).toBeGreaterThan(20);

    for (const ref of refs) {
      const png = join(buildDir, `${ref}.png`);
      const png2x = join(buildDir, `${ref}@2x.png`);
      expect(existsSync(png)).toBe(true);
      expect(existsSync(png2x)).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Layouts parse and encoder layout exists
  it("layouts parse", () => {
    const layoutsDir = join(buildDir, "layouts");
    const layoutFiles = readdirSync(layoutsDir).filter((f) => f.endsWith(".json"));
    expect(layoutFiles.length).toBeGreaterThan(0);

    for (const file of layoutFiles) {
      const fullPath = join(layoutsDir, file);
      // will throw if invalid JSON
      readJson(fullPath);
    }

    // encoder layout reference (if any)
    const manifest = readJson(join(buildDir, "manifest.json"));
    const encoderAction = manifest.Actions.find((a) => a.Encoder && a.Encoder.layout);
    if (encoderAction) {
      const encoderLayoutPath = join(buildDir, encoderAction.Encoder.layout);
      expect(existsSync(encoderLayoutPath)).toBe(true);
      // also ensure it parses
      readJson(encoderLayoutPath);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Entry HTMLs present and only reference bundled files
  it("entry HTMLs present and reference only bundled files", () => {
    const htmlFiles = ["pi.html", "plugin.html"];
    const assetRefRegex = /(?:src|href)="([^"]+)"/g;

    for (const html of htmlFiles) {
      const htmlPath = join(buildDir, html);
      expect(existsSync(htmlPath)).toBe(true);
      const content = readFileSync(htmlPath, "utf8");

      let match;
      while ((match = assetRefRegex.exec(content)) !== null) {
        const url = match[1];

        // skip external URLs, data URIs, fragments
        if (
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("data:") ||
          url.startsWith("#")
        ) {
          continue;
        }

        // Resolve relative to the build directory
        const resolved = url.startsWith("./") ? join(buildDir, url.slice(2)) : join(buildDir, url);
        expect(existsSync(resolved)).toBe(true);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Packaged artifact spot-check (if artifact exists)
  it.skipIf(!existsSync(artifactPath))("packaged artifact contains manifest.json", () => {
    try {
      const stdout = execFileSync("unzip", ["-l", artifactPath], {
        encoding: "utf8",
      });
      const expectedEntry = "com.r-teller.sonoscontroller.sdPlugin/manifest.json";
      expect(stdout).toContain(expectedEntry);
    } catch (err) {
      // If unzip binary is missing, don't fail the test - just warn.
      if (err.code === "ENOENT") {
        console.warn("`unzip` command not found; skipping zip content verification.");
        return;
      }
      // Re-throw any other errors (e.g., zip corrupted)
      throw err;
    }
  });
});
