#!/usr/bin/env node
// Increments the 4th segment of public/manifest.json's Version field.
// Used by the `build_dev_incr` npm script to bump every dev build.

import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST_PATH = "public/manifest.json";

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

manifest.Version = manifest.Version.split(".")
  .map((segment, i) => (i === 3 ? String(parseInt(segment, 10) + 1) : segment))
  .join(".");

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
