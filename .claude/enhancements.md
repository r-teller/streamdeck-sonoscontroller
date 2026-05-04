# Documentation Enhancements

Purpose: Track documentation gaps discovered during work — places where context was needed but absent from `.claude/*.md`. Each entry records what was needed, where the gap is, and a suggested fix. Resolve by updating the target doc and marking `[RESOLVED]`.

> Format per entry:
>
> ```
> ### [STATUS] Title
>
> **Needed:** What information was needed to complete a task
> **Where the gap is:** Which doc should have had this
> **Suggested fix:** Concrete edit to make
> **Discovered during:** Bead ID + brief context
> ```

---

### [RESOLVED] SDK manifest no longer has top-level `Devices` bitmask field

> Resolved 2026-05-03 — added a "Device gating" row in `architecture.md` §Technology Decisions noting per-action `Controllers` is the only gating mechanism and citing the cbz spike.


**Needed:** When triaging bead `cbz` (Spike: Stream Deck Mobile and Pedal device support), the bead description framed the recommendation as "pick the `Devices` bitmask value to declare in the manifest" — but the modern Stream Deck SDK has no such field. The bitmask was retired in or before SDK 6.x; per-action `Controllers` arrays do all device gating.

**Where the gap is:** `architecture.md` §Technology Decisions or §Manifest fields; `prd-what.md` §9 Distribution & Packaging Requirements.

**Suggested fix:** Add a one-line note in architecture.md or prd-what.md §9: "Plugin device support is gated by per-action `Controllers` arrays (`Keypad` / `Encoder`), not a top-level `Devices` bitmask. Pedal counts as a Keypad device per Elgato's Keys guide; Mobile is keypad-style." This prevents future spike beads from chasing a non-existent field.

**Discovered during:** `cbz` spike, 2026-05-03.

---

### [RESOLVED] jsdom 29 is incompatible with vitest 1.6 (use jsdom 22)

> Resolved 2026-05-03 — added a "Test runner" row in `architecture.md` §Technology Decisions noting the jsdom@22 pin requirement.


**Needed:** Setting up the `// @vitest-environment jsdom` directive for `tests/unit/xml.test.js` triggered `npm install -D jsdom` which pulled jsdom@29 by default. Vitest 1.6.1 fails on jsdom 29 with `Error: require() of ES Module .../html-encoding-sniffer.js not supported`. Downgrading to jsdom@22 resolves it.

**Where the gap is:** `architecture.md` §Technology Decisions could note the jsdom version pin, or a new "Testing" subsection in `tests.md` (when it exists).

**Suggested fix:** Pin `jsdom@22` in `package.json` (already done as a side-effect). Document in architecture.md: "Test environment: jsdom@22.x — required for vitest@1.x compatibility. Do not bump to jsdom 24+ until vitest is upgraded to 2.x."

**Discovered during:** `4kb.5` (XML→JSON converter), 2026-05-03.

---

### [RESOLVED] @elgato/streamdeck eagerly reads manifest.json at module import

> Resolved 2026-05-03 — appended a `vi.mock` note to the existing "Stream Deck SDK" row in `architecture.md` §Technology Decisions.


**Needed:** Importing `EventEmitter` from `@elgato/streamdeck` triggers the package's `getManifest()` side effect, which calls `readFileSync(join(process.cwd(), 'manifest.json'))` at module evaluation time. This breaks Vitest unit tests that run from repo root before the manifest is in cwd.

**Where the gap is:** `backend.md` §Stream Deck SDK Integration or `architecture.md` §Technology Decisions.

**Suggested fix:** Add a note: "When unit-testing modules that import from `@elgato/streamdeck`, mock the import: `vi.mock('@elgato/streamdeck', () => ({ EventEmitter: NodeEventEmitter }))`. The package's eager manifest read at module load time will otherwise break the test environment. Production code is unaffected because Stream Deck always sets cwd to the bundle directory before loading."

**Discovered during:** `4kb.4` (Stream Deck WebSocket client), 2026-05-03.

---

### [OPEN] `bd ready` includes beads with non-`ready` triage state

**Needed:** When checking what's claimable after a session, `bd ready` returned beads with `triage:backlog` or no triage label (e.g., `cbz` while still backlog, `bg9` while unlabeled). This is technically correct — `bd ready` filters by blockers, not triage state — but conflicts with the workflow's expectation that only `triage:ready` beads should be claimed.

**Where the gap is:** `rules/workflow-session.md` Session Startup section, or the `/leroy` skill spec.

**Suggested fix:** In `/leroy` step 3b's "Ready to Start" formatting, explicitly flag any bead that's `triage:backlog` or `triage:triaged` or unlabeled as **needing triage promotion** before it can be claimed. Either gray it out, group it under "Needs Triage", or filter it from the primary list with a count of "X beads need triage promotion." Currently the navigator-recon agent already does this grouping (it shows "Needs Triage" separately) — the gap is that the `bd ready` raw output doesn't, which can mislead manual `bd ready` calls.

**Discovered during:** Mid-session triage check after Phase 1 completion, 2026-05-03.

---

### [OPEN] `bd label add` does not accept multiple labels in one command

**Needed:** Tried `bd label add <id> triage:ready cynefin:clear size:small layer:infra persona:developer` to triage `bg9` — bd interpreted the trailing args as additional bead IDs and errored with "no issue found matching triage:ready". Worked around by looping one label per call.

**Where the gap is:** Could be a bd CLI feature gap or just unclear docs.

**Suggested fix:** Document in `rules/workflow-planning.md` §Labels: "bd label add accepts ONE label per call. To set multiple labels, loop: `for label in triage:ready cynefin:clear size:small; do bd label add <id> "$label"; done`." Or check whether `--labels` flag (used during create) is available on `label add`.

**Discovered during:** Wrapup task 3b — triaging `bg9`, 2026-05-03.

---

### [OPEN] `/leroy` could background `npm install` early

**Needed:** Multi-bead sessions that touch JS code typically need `npm install` (or `npm ci`) to be run before any vitest / build / validate step. Running it inline blocks the session for 30-60s of progress reporting; running it in the background while the navigator-survey agent plans the work overlaps the wait with useful work.

**Where the gap is:** `/leroy` Step 1 (Quick Environment Check) or Step 3d (Plan selected work).

**Suggested fix:** When `package.json` exists and `node_modules/` is missing or stale (mtime older than `package.json`), automatically launch `npm install` via Bash with `run_in_background: true` during Step 1 or Step 3d. The user is doing planning work in parallel; install completes by the time implementation starts. Worked well in this session — `npm install` ran while the navigator-survey produced the 6-bead plan.

**Discovered during:** Phase 1 multi-bead session, 2026-05-03.
