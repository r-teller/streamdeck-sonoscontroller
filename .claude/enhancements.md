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

---

### [RESOLVED] Service routing rule (which UPnP service goes to coord vs bound speaker) is implicit, not documented

> Resolved 2026-05-04 — added §"Service routing — bound speaker vs coordinator" subsection under §Per-action SOAP commands in backend.md with the full bound-vs-coord table and a reference to `_coordServiceFor`.


**Needed:** While implementing h75.6 (per-action SOAP commands), the routing question — "does setVolume go to the coordinator or the bound speaker?" — had to be derived from prd-what.md §5.8/5.9 prose and Sonos protocol behavior, not from a single canonical rule statement. The same question will arise for every Phase 5 action (km1.1–km1.11) and the Phase 3 polling supervisor (etr.3).

The rule, as it landed in `sonosController.js`:
- `AVTransport.*` → coordinator (Play, Pause, Next, Prev, SetAVTransportURI, queue ops, Seek, SetPlayMode, GetTransportInfo, GetTransportSettings, GetPositionInfo)
- `ContentDirectory.Browse(Q:0)` → coordinator (queue is coord-owned)
- `ContentDirectory.Browse(FV:2)` and other household-scoped browses → bound speaker (favorites are household-scoped)
- `RenderingControl.*` → bound speaker (volume / mute / bass / treble are per-speaker; group members each have their own)
- `ZoneGroupTopology.*` → bound speaker (household-scoped)
- `DeviceProperties.*` → bound speaker (per-speaker)

**Where the gap is:** `backend.md` §"Per-action SOAP commands" or a new §"Service routing" section.

**Suggested fix:** Add a "Service routing" section to backend.md with the bullet list above. Cite the per-speaker volume/mute behavior so the next session implementing a km1 action doesn't have to re-derive it from prd-what.md prose. Reference `sonosController.js` `_coordServiceFor` as the routing implementation.

**Discovered during:** `h75.6` (per-action SOAP commands), 2026-05-04.

---

### [RESOLVED] `GetZoneGroupAttributes` exists as a cheaper coordinator-resolution endpoint

> Resolved 2026-05-04 — added §"Future optimization: cheaper coordinator-resolution endpoint" subsection under §Per-action SOAP commands in backend.md with the byte/limitation tradeoffs and a reference to the closed cel spike.

---

### [OPEN] Multi-line bash curl with embedded XML body is paste-fragile

**Needed:** During the cel spike's live-capture phase, every multi-line `curl` command I gave the user (with `\` line continuations and an inline `--data-binary '<?xml ...>'` body) failed at least once due to the user's terminal/paste mode stripping or duplicating newlines mid-command. Bash then saw `-H` as a flag without value, or treated `Content-Type: ...` as a separate command. Cost ~5-7 turns of debugging across the session.

**Where the gap is:** No project doc; this is a Claude-output convention, not a project convention.

**Suggested fix:** When sharing curl commands that contain multi-line SOAP/XML payloads with the user, default to the heredoc + file-based pattern from the start:

```bash
cat > /tmp/req.xml <<'EOF'
<?xml version="1.0"?>...
EOF
curl ... --data-binary @/tmp/req.xml
```

Heredoc bodies survive paste reliably (no embedded escaping); the curl command itself is short enough to never wrap. Single-line curl is fine when there's no XML body. Switch to heredoc the moment a SOAP envelope enters the picture.

**Discovered during:** `cel` spike, 2026-05-04.

---

### [OPEN] Effort sizing — "large" items at the END of a phase are systematically over-forecast

**Needed:** h75.6 was sized `cynefin:complicated, size:large` with an expected ~50-120 turns (per work-item-templates.md size-tier guide). Actual landing was ~25 turns including 11 fixtures and 43 tests. The 4-5x under-run isn't because the work was small — it really did touch ~22 methods across multiple service classes — but because by the time h75.6 was claimed, ALL its scaffolding was already in place: `translateSonosError` from h75.7, `getInputSourceMappings` from h75.5, `resolveCoordinator` from cel, plus the `getDevices` / `getFavorites` boundary-translation pattern to copy. Most of h75.6's "implementation" was sequential application of established patterns, not novel design.

**Where the gap is:** `work-item-templates.md` size guide doesn't account for "foundation already built" effort discount.

**Suggested fix:** Add a sizing modifier to the Size Classification Guide in `work-item-templates.md`: when a `size:large` item is the LAST in its phase and its foundations are all `closed`, scale the upper end of the turn estimate down by ~50%. Conversely, when a `size:large` item is the FIRST in a phase, lean toward the upper bound. Captures the reality that pattern-application is much cheaper than pattern-discovery.

**Discovered during:** `h75.6`, 2026-05-04.

**2026-05-04 update (Phase 4 PI batch — second data point):** The same pattern holds for `medium` and `small` beads, not just `large`. Across orw.2/3/5/6/7/8/9/10/11/12 (all in Phase 4), every bead under-ran by 12-33%, with the largest under-runs on the medium beads landing AFTER their foundations (orw.7 at -33%, orw.8 at -28%). Once orw.11 (action-settings schema) and orw.12 (global-settings schema) closed, every subsequent UI bead consumed those builders + the `buildSaveInput` helper without inventing new patterns. Recommend extending the sizing modifier to apply to ALL size tiers, not just `large`: when a bead's foundations are closed AND a comparable pattern exists in the same epic, scale the upper bound down by ~25%.


**Needed:** The cel spike's Q5 ("is there a cheaper-to-poll endpoint than `GetZoneGroupState`?") landed an answer: `ContentDirectory.Browse` is not relevant, but `ZoneGroupTopology#GetZoneGroupAttributes` returns `CurrentZoneGroupID` formatted as `<COORD_UUID>:<seq>` (~600 bytes vs ~5KB). Splitting on `:` gives the coordinator UUID directly without walking topology. **Caveat:** `CurrentZonePlayerUUIDsInGroup` lists only PRIMARY members — satellites (sub, surrounds) are absent. So this is a viable optimization for primary-member binds but cannot resolve a satellite's coordinator.

This is documented in `.archive/plans/2026-05-03-coordinator-resolution.md` (gitignored) and as a `bd comments` entry on h75.6, but neither place is loaded into context for future sessions.

**Where the gap is:** `backend.md` §"Per-action SOAP commands" or a new §"Available endpoints we don't use yet" section.

**Suggested fix:** Add a one-paragraph "Future optimization opportunities" callout to backend.md noting `GetZoneGroupAttributes` as a backup coord-resolution endpoint, with the satellite-absence caveat. Helps a future session reaching for "make polling cheaper" find the existing investigation rather than redoing the SCPD scan.

**Discovered during:** `cel` spike (live capture from S2 firmware 86.6-75110), 2026-05-04.

---

### [RESOLVED] Vue component testing pattern was undocumented

> Resolved 2026-05-04 — added §"Component Testing" subsection to `frontend.md` with the @vue/test-utils + vi.mock(sdConnect) + sdClient injection pattern.


**Needed:** While implementing orw.2 (BootstrapAccordeonItem), the project had no installed Vue component testing library and no documented pattern for testing `.vue` files. Existing tests covered pure modules only. The session had to pause to decide whether to install `@vue/test-utils` or hand-roll mounts via `createApp` + jsdom queries. Same blocker would surface in every Phase 4 PI bead going forward.

**Where the gap is:** `frontend.md` had no §"Testing" section. `architecture.md` Technology Decisions listed Vitest but no Vue component testing companion.

**Suggested fix:** Add a §"Component Testing" subsection to `frontend.md` documenting:
- `@vue/test-utils` is the canonical Vue component testing library
- Standard pattern: `vi.mock("@/modules/common/sdConnect.js", () => ({ streamDeckReady: new Promise(() => {}), ... }))` to bypass the SDK bridge in tests
- Mount with `mount(PiComponent)`, then inject `wrapper.vm.sdClient = mockSd` to test save paths
- Mock the `SonosController` import for discovery-flow tests via `vi.mock("@/modules/common/sonosController.js")`

**Discovered during:** orw.2 (BootstrapAccordeonItem), 2026-05-04.

---

### [OPEN] Bead specs that mention HTML-attribute-encoding workarounds should specify the option carrier explicitly

**Needed:** orw.6 (action-specific sections) and orw.11 (saveSettings schema) both mention that favorite metadata is "base64-encoded when held in dropdown options to avoid HTML attribute encoding issues." But the spec didn't explicitly say which option carrier (option `value` attribute, `data-*` attribute, or just an internal lookup keyed by URI). Three reasonable implementations exist; I picked URI-as-value-with-favorite-lookup, which sidesteps the encoding entirely. The orw.11 base64-decode test path remained valid as defensive code but doesn't run in the production flow.

**Where the gap is:** Bead specs that mention HTML-encoding workarounds should specify the carrier (e.g., "option value attribute holds base64-encoded metadata; change handler decodes on save").

**Suggested fix:** When a bead's spec describes a workaround like "X is base64-encoded to avoid HTML attribute encoding issues", the spec should also state explicitly: "the carrier is the option's `value` attribute" (or whatever the chosen carrier is). Otherwise the implementer faces 2-3 reasonable design choices and may sidestep the workaround entirely without realizing the test path becomes dead code.

**Discovered during:** orw.6 (action-specific sections, favorites dropdown), 2026-05-04.

---

### [OPEN] PI auto-save dispatch shape (the buildSaveInput pattern) is not in any bead

**Needed:** orw.5 (presentation toggles), orw.6 (action-specific sections), orw.7 (volume override), and the speaker selection in orw.9 all need to call `saveSettings` with the full 16-field per-context schema after a single field changes. None of those beads documented HOW to construct the full input — each implies "auto-save the change" without specifying that all 16 fields must be re-supplied. The `buildSaveInput(overrides)` helper that merges actionInfo + current settings.value + the changed field was an implementation invention.

**Where the gap is:** Either a parent bead (orw, the epic) or a shared "PI auto-save semantics" subsection in `frontend.md`.

**Suggested fix:** Add a §"Auto-save dispatch" subsection to `frontend.md` documenting:
- All change handlers in PiComponent must produce the full 16-field per-context schema, not just the changed field
- The `buildSaveInput(overrides = {})` helper merges actionInfo + settings.value + overrides for this purpose
- Schema gaps in any field land as `null` per `actionSettingsSchema.buildActionSettingsPayload` and are tolerated by the action handlers via `?? <default>`

**Discovered during:** orw.5/orw.6/orw.7 — every bead in the per-action UI surface invented a piece of this pattern, 2026-05-04.

---

### [OPEN] Don't smoke-test file-mutating scripts via the full npm script

**Needed:** During bg9 implementation, I ran `npm run build_dev_incr` to verify the new `bin/bump-version.mjs` worked. The script bumped the version (which I needed to revert) AND ran `vite build`, which had nothing to do with verifying the bumper. Worse, `bin/bump-version.mjs` does `JSON.stringify(manifest, null, 2)` — which reformatted every previously-compact `Controllers: ["Keypad"]` array into a multi-line array. The reformatting was not part of bg9's intent but landed in the bg9 commit's diff anyway because reverting was non-trivial. Cost: ~30 lines of noise in the bg9 commit and a few minutes of "is this OK to commit?" deliberation.

**Where the gap is:** No project doc — this is a Claude self-discipline note.

**Suggested fix:** When smoke-testing a script that mutates a tracked file, do one of:
1. `git stash --keep-index` first, run the script, inspect, `git checkout <file>` to revert, `git stash pop`
2. Run the script in isolation (e.g., `node bin/bump-version.mjs`) — NOT via its npm script when the npm script runs additional steps
3. Test on a copy of the file: `cp public/manifest.json /tmp/m.json && MANIFEST_PATH=/tmp/m.json node bin/bump-version.mjs` (requires the script to honor an env override)

The cleanest is #2 — isolate the unit under test. Reserve full pipeline runs for integration verification AFTER the unit test passes.

**Discovered during:** bg9 (ESM build_dev_incr refactor), 2026-05-04.
