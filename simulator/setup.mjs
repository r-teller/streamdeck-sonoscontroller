// Copies the build_dev bundle into simulator/dist and injects sim-host.js as the
// first script of plugin.html / pi.html so the shim runs before any bundle code.
import { cpSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "com.r-teller.sonoscontroller.sdPlugin");
const DST = join(ROOT, "simulator/dist");
if (!existsSync(SRC)) { console.error("build first: npm run build_dev"); process.exit(1); }
cpSync(SRC, DST, { recursive: true });
for (const page of ["plugin.html", "pi.html"]) {
  const f = join(DST, page);
  let html = readFileSync(f, "utf8");
  if (!html.includes("sim-host.js")) html = html.replace(/<head>/i, '<head><script src="/sim-host.js"></script>');
  writeFileSync(f, html);
}
console.log("simulator/dist ready (sim-host injected)");
