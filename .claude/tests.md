# Testing Strategy

Purpose: How the rebuild verifies behavior. The existing repo has **zero automated tests** — CI runs `format:check`, `lint`, `build`, and `validate` (Elgato CLI bundle linter) only. The rebuild establishes a real test pyramid.

> The Stream Deck plugin runtime is unusual: the plugin background is a Node-hosted webview, the PI is an embedded webview, both connect to the host via `ws://localhost:<port>`, and the only "API" is SOAP over HTTP to port 1400. The test strategy reflects that — unit tests for pure logic, integration tests against captured fixtures + a mock SOAP server, functional tests for the PI in a real browser, and end-to-end tests with a fake Stream Deck app + fake Sonos household.

---

## 1. Testing Philosophy

**Overall Goal: Ensure the most critical user journeys always work, and prevent every regression we know about.**

Specifically:
- **Discovery must succeed** against single-zone, multi-zone, stereo-pair, and home-theater households (PR #3 regression).
- **Volume increment resolution** must respect per-button overrides (including the value `1`) and fall back to the global default when null (PR #4 regression — `??` vs `||`).
- **No flashing.** The render dedupe must hold over 60+ seconds of polling on a stable speaker.
- **Errors carry actionable messages** — never `"u is not iterable"` to the user.

Coverage target: 70 % line coverage on `src/modules/` (excluding the dead `utils.js` and the worker shim). Coverage is a sanity check, not a goal — a passing test that asserts behavior matters more than a covered line.

---

## 2. Types of Tests

- **Unit tests:** Yes. Pure functions and class-isolated tests. No network, no DOM, no Stream Deck. Goal: deterministic and fast (< 2 s suite). Live under `tests/unit/`.
- **Integration tests:** Yes. Wire two or more units together against captured XML fixtures and a local mock SOAP server. Still no real Stream Deck. Live under `tests/integration/`.
- **Functional tests:** Yes. Property Inspector exercised as a black-box SPA in a real browser via Playwright. The plugin process is mocked at the WebSocket boundary. Live under `tests/functional/`.
- **End-to-End (E2E) tests:** Yes (CI-on-`main`-only). Whole-system: plugin process + PI process + a fake Stream Deck app + a fake Sonos household. Live under `tests/e2e/`.

---

## 3. Frameworks & Tools

- **Vitest** for unit + integration. Zero-config under Vite, shares the existing `vite.config.js` resolver and ESM handling. Run via `npm test`.
- **Playwright** for functional + E2E. PI is a normal SPA so it loads cleanly in Chromium. Run via `npm run test:functional` and `npm run test:e2e`.
- **`tests/helpers/mockSonosServer.js`** — a `http.createServer` SOAP mock that serves XML fixtures from `tests/fixtures/sonos/` based on `SOAPAction` header routing. Node built-ins only — no external deps.
- **`tests/helpers/streamDeckMock.js`** — a WebSocket harness that opens on the port the PI's `connectElgatoStreamDeckSocket` hook expects, replays the registration handshake, then scripts `didReceiveSettings` / `didReceiveGlobalSettings` payloads and asserts what the PI sends back.
- **Coverage:** Vitest's c8 reporter, gated at 70 % line on `src/modules/`.

### Commands

| Command | Purpose | Target time |
|---|---|---|
| `npm test` | Vitest unit + integration | < 30 s |
| `npm run test:functional` | Playwright against `pi.html` | < 60 s |
| `npm run test:e2e` | Playwright + plugin harness + mock Sonos | < 3 min |
| `npm run coverage` | Vitest with c8 | runs alongside `test` |

---

## 4. Test Pyramid Detail

### 4.1 Unit tests (`tests/unit/`)

| Target | What to assert |
|---|---|
| `SonosService.execute` (SOAP envelope construction) | For every action (Play, Pause, SetVolume, SetMute, SetPlayMode, SetAVTransportURI, Seek, Browse, GetZoneGroupState, GetTransportInfo, GetMute, GetVolume, GetBass, GetTreble, GetPositionInfo, RemoveAllTracksFromQueue, AddURIToQueue, SetBass, SetTreble): expected URL (`http://<host>:1400/<prefix>/Control`), `SOAPAction` header value, body XML matches a snapshot. Mock `globalThis.fetch`. |
| `convertXmlToJson` | Single-child element returns object (regression for PR #3). Multiple siblings of the same tag return array. Mixed-content nodes preserve `_text`. CDATA payloads survive round-trip. |
| ZoneGroup normalization (`getDevices`, `getDeviceLocation`) | Given a fixture with one `ZoneGroup`, returns iterable of length 1. Given a fixture with three `ZoneGroup`s, returns iterable of length 3. Given missing `ZoneGroups`, returns empty iterable (no throw). |
| `getInputSourceMappings(uri)` | Each documented prefix (`x-sonos-spotify:`, `x-sonos-htastream:`, `x-rincon-stream:`, `x-rincon-queue:`, `x-sonos-http:`, `x-sonosapi-stream:`) maps to the right source name and prefix/suffix factories produce the expected next-URI given a coordinator UUID. |
| Volume increment resolution (PR #4) | Per-action `adjustVolumeIncrement=2` overrides global `10`. Per-action `null`/`undefined` falls back to global. Per-action **`1`** (truthy edge) is **not** silently replaced (regression for `??` vs `\|\|`). New volume clamps to `[0, 100]`. |
| `SonosSpeakers` rate limiter | After 3 `UPDATING` transitions inside 10 s, fourth call flips to `RATE_LIMITED`. After window decays, transitions resume. `UPDATED` resets `updateAttempts`. Context add/move/remove updates `contexts: string[]` atomically. |
| Marquee/title state machine (`updateStreamDeckStateAndTitle`) | Given a fixed `playing.title` longer than `marqueeWidth`, top/bottom positions advance one char per call until wrapping. Album-art URI change resets marquee position. |
| Custom timer worker (`src/modules/common/timers.js`) | `setTimeout` and `setInterval` shims fire in JSDOM with a polyfilled `Worker`; `clearTimeout` cancels a pending fire. (Use `vi.useFakeTimers` substitute.) |
| Render dedupe predicates | Per-field comparison (image, state, title, feedback) returns "unchanged" for identical inputs. Marquee scope dedupes on source string, not per-frame substring. |

### 4.2 Integration tests (`tests/integration/`)

**Fixture corpus.** Capture once from a real household and treat as canonical (do not hand-edit):

- `GetZoneGroupState`: single-zone, two-zone, two-group, with-satellite
- `GetVolume` / `GetMute` / `GetBass` / `GetTreble`
- `GetTransportInfo`: PLAYING / PAUSED / STOPPED / TRANSITIONING
- `GetPositionInfo`: with and without album art
- `Browse FV:2`: empty, 1 favorite, 50 favorites
- `Browse Q:0`: empty, populated

Stored as XML files under `tests/fixtures/sonos/`.

**Mock SOAP server (`tests/helpers/mockSonosServer.js`).** Serves fixtures on `http://127.0.0.1:1400` with proper `SOAPAction` routing.

**Targets:**
- `SonosController.getDevices({setAsPrimary: true})` end-to-end against each topology fixture; assert resulting device list shape, `primary` flag, satellite detection, and that single-zone households produce one device (PR #3 regression).
- `SonosController.getFavorites()` against each favorite fixture; assert title/uri/metadata/albumArtURI extraction.
- `SonosSpeakers.getSpeaker({UUID})` driving a full `Promise.all` of the 7 polled SOAP calls against the mock server; assert resulting `state` matches a snapshot.
- `setServiceURI` for the queue path (`AddURIToQueue` → `SetAVTransportURI x-rincon-queue:<coord>#0` → `Seek TRACK_NR 1`) and the radio-stream short-circuit (`x-sonosapi-stream:` → direct `SetAVTransportURI`); assert SOAP call sequence captured by the mock server.
- `play_sonos_favorite_action` orchestration: assert `RemoveAllTracksFromQueue` precedes the queue setup and `Play` is the final call.
- PR #4 volume increment threading: drive `PluginComponent.callAction` with a synthesized `keyDown` for a Volume Up context, with both per-button override absent and present (including `1`); assert the `SetVolume(DesiredVolume=N)` request body the mock server received.

### 4.3 Functional tests (`tests/functional/`)

PI as a black-box SPA in Playwright. Plugin mocked at the WebSocket boundary by `streamDeckMock.js`.

**Scenarios:**
- **First-run discovery.** Empty global settings → only the "Global Settings" accordion is visible and auto-expanded; speakers list is hidden. Filling Primary Device Address and clicking "Save and Connect" emits `setGlobalSettings` with `{devices, deviceCheckInterval, deviceTimeoutDuration, adjustVolumeIncrement, favorites}`.
- **Reconnect.** Pre-seeded global settings → button reads "Save and Reconnect", accordion is collapsed, speakers list populated. Clicking re-fires `getDevices`/`getFavorites`.
- **Speaker selection persistence.** Selecting a speaker in the dropdown writes `setSettings` with the right `uuid`, `hostAddress`, `zoneName`, and `title` (`<zone> (<host>)`).
- **Per-action conditional rendering.** For each action UUID, assert which sections appear (Play Modes for `toggle-play-mode`, Input Sources for `toggle-input-source`, Equalizer Target for `encoder-audio-equalizer`, Sonos Favorites dropdown for `play-sonos-favorite`, Volume Increment override for `volume-up`/`volume-down`, etc.). Drive the test by iterating every action UUID — the manifest is the source of truth.
- **PR #4 — Global "Volume Increment (Up/Down)" field.** Default value `10`. Setting `0` is clamped to `1` before persisting. Setting `15` and saving emits `setGlobalSettings` with `adjustVolumeIncrement: 15`. Field appears inside the Global Settings accordion below `deviceCheckInterval`.
- **PR #4 — Per-button Volume Increment override.** Visible only when `actionName ∈ {volume-up, volume-down}`. Placeholder reads `"Global default: <N>"` reflecting current global value. Leaving empty persists `null`; entering `1` persists `1` (regression for `??` semantics); entering `5` persists `5`.
- **Error rendering.** A synthesized error event renders as a red dismissible alert in the Global Settings accordion; clicking dismiss removes it.
- **Equalizer target switching.** Changing the target dropdown to BASS emits `setSettings` and triggers a `sendToPlugin` event (or a settings change the plugin will react to) so the plugin can call `setFeedbackLayout` to swap from `encoder-bar-0-100.json` to `encoder-gbar-10-10.json`.
- **Speaker filter.** Typing `"of"` in the filter input narrows the dropdown to options whose label or UUID contains `"of"` case-insensitively.
- **Satellite badge.** Speakers with `isSatellite: true` render with the 🛰️ suffix.

### 4.4 E2E tests (`tests/e2e/`)

Whole-system: plugin process + PI process + fake Stream Deck app + fake Sonos household. No real hardware required.

- **Fake Stream Deck app.** Node script that stands up the WebSocket server the Stream Deck app would expose, then launches `plugin.html` and `pi.html` under Playwright as separate browser contexts. Replays the real Stream Deck handshake (`registerPlugin`, `registerPropertyInspector`) and forwards events between them.
- **Fake Sonos household.** Mock SOAP server from §4.2 on `127.0.0.1:1400`, optionally wrapped with a latency proxy to simulate slow networks.

**Scenarios (each is a "user story" walkthrough):**

| Story | What it proves |
|---|---|
| Install → discover → place a key → press it | Boot plugin, send `willAppear` for Toggle Mute with placeholder context, open PI, complete first-run discovery, select a speaker, close PI, send `keyDown` → assert `SetMute` SOAP request hit fake Sonos and plugin emitted `setState` with the unmuted index |
| Poll loop reflects external state | With a key bound to a speaker, mutate fake Sonos's reported volume from 30 to 60 between polls; assert that within `2 × deviceCheckInterval` the plugin issues `setFeedback` with the new value (encoder) or `setTitle` (keypad with state-based title enabled) |
| Speaker offline | Take fake Sonos offline; assert plugin transitions speaker to `DISCONNECTED`, calls `showAlert` on `keyDown`, and recovers when fake Sonos comes back |
| Rate limit | Fire `keyDown` 5× in 2 s on a Volume Up key; assert at most 3 `SetVolume` requests reach the fake Sonos within the 10 s window and the speaker enters `RATE_LIMITED`, then resumes |
| PR #4 increment resolution | Set global increment to 5, place two Volume Up keys, override one to `1` — three `keyDown` events on the overridden key produce `+1, +1, +1`; three on the non-overridden key produce `+5, +5, +5`. The override-set-to-`1` case proves the `??` fix in production. |
| PR #3 single-zone household | Configure fake Sonos to advertise a single ZoneGroup. First-run discovery completes without `groups is not iterable`. Single device appears in PI dropdown and can be bound to a key. |
| SD+ encoder layout swap | With an Equalizer encoder, change Equalizer Target VOLUME → BASS via PI; assert plugin issues `setFeedbackLayout("encoder-gbar-10-10.json")` and subsequent dial rotations call `SetBass(DesiredBass=N)` clamped to `[-10, 10]` |
| Timer worker survives backgrounding | Patch test harness to throttle JS timers (simulate webview backgrounding); assert worker-backed `setInterval` continues to drive poll loop on schedule (within ±200 ms) |
| Render dedupe over 60 s | Bind a key to a stable Sonos state (paused, fixed track, no marquee); collect 60 s of `setImage`/`setState`/`setTitle` calls; assert each call's value differs from the previous (no flashing) |

---

## 5. CI Integration

Add to `.github/workflows/`:
- `npm test` (Vitest, unit + integration) → required check on all PRs. Target: < 30 s.
- `npm run test:functional` (Playwright against `pi.html` only) → required check; Playwright browsers cached.
- `npm run test:e2e` (Playwright + plugin harness) → required check on `main` only (slower, ~3 min). Allow opt-in on PRs via a `run-e2e` label.
- `coverage` step using Vitest's c8 reporter; gate at 70 % line coverage on `src/modules/` (excluding the dead `utils.js` and the worker shim).

---

## 6. Out of Scope

- **Real-hardware Stream Deck device tests.** The Elgato SDK doesn't expose a deterministic device-side assertion API; on-device verification stays manual. A small manual smoke checklist (drag every action onto a key, confirm icon and title render correctly) belongs in the release runbook, not in CI.
- **Real Sonos S1 households.** Targeting S2; S1 compatibility is best-effort and not in CI.
- **Visual regression on key bitmaps.** Generated icons are committed; their pixel output is verified by the existing `validate` step against the manifest, not by image diff.
- **Performance / load testing.** A single user pressing one key at a time is the load model; there is no sense in stress-testing.

---

## 7. Key Test Scenarios (canonical "must pass" list)

| Scenario | Test type | Anchor |
|---|---|---|
| Discovery succeeds against single-zone household (PR #3) | Integration / E2E | `tests/integration/discovery.test.js`, `tests/e2e/single-zone.spec.js` |
| Discovery succeeds against multi-group household | Integration | `tests/integration/discovery.test.js` |
| Discovery succeeds against home-theater + satellites | Integration | `tests/integration/discovery.test.js` |
| Volume Up with per-button override `1` produces `+1` (PR #4) | Unit / E2E | `tests/unit/volume.test.js`, `tests/e2e/volume-increment.spec.js` |
| Volume Up with no override falls back to global default `10` | Unit / E2E | as above |
| `SetMute` toggle round-trips and updates state index | E2E | `tests/e2e/install-and-mute.spec.js` |
| Encoder layout swap on Equalizer Target change | E2E | `tests/e2e/encoder-layout.spec.js` |
| Render dedupe holds for 60 s on a stable speaker | E2E | `tests/e2e/no-flashing.spec.js` |
| Speaker `DISCONNECTED` on timeout, recovers on reconnect | E2E | `tests/e2e/speaker-offline.spec.js` |
| Rate limit kicks in after 3 attempts in 10 s, releases after window | Unit / E2E | `tests/unit/rate-limit.test.js`, `tests/e2e/rate-limit.spec.js` |
| Error messages are translated at the boundary (no `"u is not iterable"`) | Unit | `tests/unit/error-messages.test.js` |
