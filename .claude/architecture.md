# Architecture Overview

Purpose: High-level system context for quick orientation. Answers: "What is this? How does it fit together? How do I run it?"

> This is the first file a new session should read. Keep it to one page of essentials. Detailed domain docs (backend.md, frontend.md, data-model.md) go deeper.

---

## What We're Building

- **Project Name:** Sonos Controller for Stream Deck
- **One-Sentence Summary:** An Elgato Stream Deck plugin that turns the dedicated keys, encoders (rotary dials), and touch strip into a tactile, glanceable control surface for any Sonos speaker on the local network.
- **Programming Languages:**
  - **Plugin background (runs in Stream Deck Node.js host):** JavaScript (ESM, ES2022)
  - **Property Inspector (runs in Stream Deck embedded webview):** JavaScript (ESM, ES2022)
- **Main Frameworks/Tools:**
  - **UI framework:** Vue 3 (Composition API + `<script setup>`) — used for both `plugin.html` (headless background) and `pi.html` (Property Inspector)
  - **Bundler:** Vite 4 (multi-entry: `plugin.html` + `pi.html` → `com.r-teller.sonoscontroller.sdPlugin/`)
  - **PI styling:** Bootstrap 5 (dark theme via `data-bs-theme="dark"`)
  - **Stream Deck SDK:** Hand-rolled `ws://localhost:<port>` WebSocket client; only `EventEmitter` is consumed from `@elgato/streamdeck`
  - **Sonos integration:** Direct UPnP/SOAP-over-HTTP to port 1400 (no third-party Sonos library, no cloud, no auth)
  - **Auth:** None (LAN-only, port 1400 is unauthenticated for same-LAN clients)
  - **Database / Storage:** Stream Deck `setGlobalSettings` / `setSettings` (JSON blobs persisted by the host app); no DB
  - **Async / events:** Polling loop (500 ms supervisor) + Web Worker–backed timer shim to survive webview backgrounding

---

## Product Guidance

### Vision

Sonos's official mobile and desktop apps are great for browsing music but heavy for one-handed, glance-and-tap control. This plugin gives Stream Deck owners physical buttons and dials that mute, play/pause, skip, switch input, change play mode, play a favorite, or nudge volume on a *specific* Sonos speaker — with the speaker's live state shown on the key face. Setup is one-time (enter a single Sonos IP; the plugin enumerates the rest).

### Product Principles

1. **Single-tap, glanceable control of one specific speaker per button.** No menus, no navigation, no app context-switching.
2. **Live state on the key face.** The user always sees whether a speaker is playing/muted, what input it's on, and what's currently playing.
3. **LAN-only, zero telemetry, zero cloud.** No Sonos OAuth, no analytics, no off-LAN traffic.
4. **No flashing.** Visual updates are deduped — keys/dials only redraw when the *displayed* value changes.
5. **Defensive enumeration.** Every iteration over `ZoneGroup`, `ZoneGroupMember`, and `Satellite` must handle the single-element case (XML→JSON collapses single children to objects, not one-element arrays).

### Explicit Exclusions

| Excluded Feature | Rationale | Status |
|------------------|-----------|--------|
| Multi-room grouping management | Out of MVP scope; plugin operates on the speaker's coordinator implicitly | Deferred |
| Queue management beyond favorites | Favorites are the only way to start specific item playback in the PI | Deferred |
| Sonos cloud / third-party music account browsing | PI uses whatever favorites the user already starred in the Sonos app | Permanent |
| SSDP / multicast discovery | Avoids Stream Deck firewall prompts and works across VLANs | Permanent |
| Long-press behavior | `keyUp` is intentionally not consumed | Deferred |
| Dial-press on Audio Equalizer | No-op in MVP; future scope might cycle Volume → Bass → Treble | Deferred |
| Internationalization | English only in v1 | Deferred |
| Sonos S1 special-casing | Targets S2 protocol; tested only on S2 firmware (86.6-75110, 94.1-76070, ZPS9 platform). S1 households are not tested and have no first-class support path. | Permanent |
| Persisted runtime cache across restarts | Live state (current track, volume) is rebuilt from polling on every plugin start | Permanent |

### Target Personas

| Persona | Description | Priority |
|---------|-------------|----------|
| Casey, the WFH desk worker | Owns a Sonos Era 100 (office) + Beam (living room), Stream Deck XL on the desk. Wants per-room columns of buttons (mute, play/pause, volume, skip, favorite). | Primary |
| Morgan, the home theater enthusiast | Owns a Sonos Arc + Sub + One SLs and a Stream Deck +. Wants a dedicated dial for living-room volume, a TV/Queue input toggle, and a now-playing tile. | Primary |
| Developer | Maintains the plugin: builds with Vite, packages with `streamdeck pack`, debugs via Chrome devtools attached to the plugin webview. | Secondary |

---

## Technology Decisions

Before adding a new library, check this table — the problem may already be solved.

| Category | Component | Version | Rationale |
|----------|-----------|---------|-----------|
| **Language** | JavaScript (ESM) | ES2022 | Stream Deck plugin webview + Node host; `"type": "module"` |
| **Runtime** | Node.js (plugin host) | 20 | Declared in `manifest.json` `Nodejs.Version: "20"`, `Debug: "enabled"` |
| **UI Framework** | Vue 3 | ^3.3.4 | Composition API + `<script setup>`; one app for `plugin.html`, one for `pi.html` |
| **Bundler** | Vite | ^4.4.9 | Multi-entry build → `com.r-teller.sonoscontroller.sdPlugin/` |
| **CSS / Components** | Bootstrap 5 | ^5.3.2 | PI accordion, form-switch, alerts; dark theme |
| **Stream Deck CLI** | `@elgato/cli` | ^1.0.1 | `streamdeck validate` / `streamdeck pack` |
| **Stream Deck SDK** | `@elgato/streamdeck` | ^1.2.0 | Only `EventEmitter` consumed; WebSocket client is hand-rolled. Note: importing from this package eagerly reads `manifest.json` from `process.cwd()` — unit tests must `vi.mock('@elgato/streamdeck', () => ({ EventEmitter: NodeEventEmitter }))`. |
| **HTTP client** | native `fetch` | n/a | `axios` is in `package.json` but unused — prefer fetch |
| **Linter** | ESLint + `eslint-plugin-vue` + Prettier passthrough | latest | `vue/vue3-essential` + `eslint:recommended` |
| **Formatter** | Prettier | ^3.0.3 | Print width 128 |
| **Test runner** | Vitest | ^1.0.0 | jsdom environment for DOM-touching tests; pin `jsdom@22.x` (jsdom 24+ is incompatible with vitest 1.x due to a CJS/ESM mismatch in `html-encoding-sniffer`). |
| **Vue component testing** | `@vue/test-utils` | ^2.4.10 | Standard `mount(Component, { props })` API. Pattern for components that consume the SDK bridge: `vi.mock("@/modules/common/sdConnect.js", () => ({ streamDeckReady: new Promise(() => {}), installStreamDeckBridge: vi.fn(), getStreamDeckClient: vi.fn(() => null) }))` then inject mock client via `wrapper.vm.sdClient = mockSd`. See `frontend.md` §Component Testing. |
| **Icon source** | `material-design-icons` (git submodule, `outlined` variant) | n/a | Rasterized to PNG by `generateImages.sh` (ImageMagick) |
| **Stream Deck app** | host application | ≥ 6.5 | Minimum version that supports `Encoder` / `setFeedback` (Stream Deck +) — confirmed by spike `streamdeck-sonoscontroller-8ss` (see `.archive/plans/2026-05-03-streamdeck-sdk-compat.md`) |
| **Supported OS** | macOS / Windows | macOS 10.11+, Windows 10+ | Per `manifest.json` `OS` block |
| **Device gating** | per-action `Controllers` array | n/a | Modern SDK has no top-level `Devices` bitmask field; per-action `Controllers: ["Keypad"]` or `["Encoder"]` is the only gating mechanism. Pedal counts as Keypad; Mobile is keypad-style. Spike `streamdeck-sonoscontroller-cbz` confirmed (see `.archive/plans/2026-05-03-streamdeck-device-support.md`). |

> **Update strategy:** Dependencies are updated manually. Several listed dependencies (`axios`, `sonos`, `js-yaml`, `nunjucks`, `snapsvg-cjs`, `fs`, `core-js`, `@mdi/font`, `@mdi/js`) are vestigial in the existing codebase and should be removed during the rebuild rather than carried forward.

---

## How to Run

### Prerequisites

- Node.js 20 (matches `manifest.json` `Nodejs.Version`)
- Stream Deck application 6.5+ installed (macOS 10.11+ or Windows 10+)
- A Sonos speaker reachable on the local LAN with port 1400 open from the Stream Deck host
- ImageMagick (only if regenerating icons via `generateImages.sh`)
- `git submodule update --init --recursive` to pull `material-design-icons` (only required for icon regeneration)

### Local Development

```bash
# Install dependencies
npm install

# Build the plugin bundle (debug, with sourcemaps and auto-bumped manifest version)
npm run build_dev_incr

# Validate the produced .sdPlugin against Elgato's CLI
npm run validate

# Package into a .streamDeckPlugin (zip)
npm run package
```

Side-load by symlinking the build output into the Stream Deck plugins directory:
- macOS: `ln -s "$(pwd)/com.r-teller.sonoscontroller.sdPlugin" ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/`
- Windows: junction `%appdata%\Elgato\StreamDeck\Plugins\com.r-teller.sonoscontroller.sdPlugin` → repo build output

After each rebuild, right-click the plugin in the Stream Deck app → "Reload" to pick up changes. The auto-bumped `Version` field is what convinces Stream Deck to re-load the manifest.

### Environment Health Checks

Used by `/leroy` and `/gogogo` to verify the dev environment is ready. Update this table when adding new services.

| Service | Check Command | Expected |
|---------|--------------|----------|
| Node version (dev tooling) | `node --version` | `v20.x.x` or newer (manifest pins plugin runtime to Node 20; dev tooling tolerates Node 22) |
| Dependencies installed | `test -d node_modules && echo "ok"` | `ok` |
| Build output exists | `test -d com.r-teller.sonoscontroller.sdPlugin && echo "exists"` | `exists` (run `npm run build` if missing) |
| Manifest is valid | `npm run validate` | exits 0 with no errors |
| Tests pass | `npx vitest run` | `Tests N passed (N)` with no failures |
| Sonos primary device reachable | `curl -s -m 3 -o /dev/null -w "%{http_code}" http://<PRIMARY_IP>:1400/xml/device_description.xml` | `200` |
| material-design-icons submodule | `test -d material-design-icons/svg/outlined && echo "ok"` | `ok` (only needed for icon regen) |

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Stream Deck application (host)                    │
│  ┌────────────────────────────┐         ┌───────────────────────────┐  │
│  │ Plugin background          │  ws://  │ Property Inspector (PI)   │  │
│  │ (plugin.html, Node 20)     │◀───────▶│ (pi.html, embedded view)  │  │
│  │ Vue 3 + custom WS client   │ setSet- │ Vue 3 + Bootstrap 5       │  │
│  │ • action dispatcher        │  tings  │ • speaker picker          │  │
│  │ • 500ms polling supervisor │         │ • per-action toggles      │  │
│  │ • render dedupe / marquee  │         │ • global settings form    │  │
│  └─────────────┬──────────────┘         └───────────┬───────────────┘  │
│                │                                    │                   │
│                ▼ HTTP/SOAP (port 1400)              ▼ HTTP/SOAP        │
└────────────────┼────────────────────────────────────┼──────────────────┘
                 │                                    │
                 ▼                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │              Sonos LAN (UPnP / SOAP / 1400)         │
        │  ZoneGroupTopology · AVTransport · RenderingControl │
        │  DeviceProperties · ContentDirectory · AudioIn      │
        └─────────────────────────────────────────────────────┘
```

Key dataflows:

- **Action press → Sonos call.** `keyDown`/`dialRotate`/`touchTap` → `actionFunctionMap[shortName].keyDown` → fresh `SonosController` → SOAP to port 1400 → optimistic state update → `setState`/`setImage`/`setFeedback`.
- **Polling.** 500 ms `setInterval` walks every known speaker; if `secondsLastChecked >= deviceCheckInterval` and not `UPDATING`/`RATE_LIMITED`, fires 7 SOAP calls in `Promise.all` and refreshes every attached context.
- **Discovery.** PI's "Save and Connect" button → `GetZoneGroupState` from the user-supplied IP → enumerate every `ZoneGroupMember` and `Satellite` → `Browse FV:2` for favorites → persist via `setGlobalSettings`.

---

## Directory Structure

```
streamdeck-sonoscontroller/
├── package.json                    # Build/lint/format scripts, deps
├── vite.config.js                  # Multi-entry build → com.r-teller.sonoscontroller.sdPlugin/
├── plugin.html                     # Background plugin entry, mounts PluginComponent.vue
├── pi.html                         # Property Inspector entry, mounts PiComponent.vue
├── generateImages.sh               # Bash + ImageMagick → public/images/{actions,keys,category}.png
├── material-design-icons/          # Submodule providing svg/outlined/*.svg source icons
├── public/
│   ├── manifest.json               # Stream Deck plugin manifest (UUIDs, actions, OS, encoder layouts)
│   ├── images/{sonos,category,plugin,actions,keys}/*.png
│   └── layouts/
│       ├── encoder-audio-equalizer.json
│       ├── encoder-bar-0-100.json
│       └── encoder-gbar-10-10.json
├── src/
│   ├── plugin/main.js              # Mounts PluginComponent into #app for plugin.html
│   ├── pi/main.js                  # Mounts PiComponent + imports bootstrap JS + scss
│   ├── components/
│   │   ├── PluginComponent.vue     # Plugin-side wiring (SD socket, dispatch, polling)
│   │   ├── PiComponent.vue         # Full PI UI
│   │   ├── SonosSelection.vue      # <select size=5> with text filter
│   │   └── accordeon/{BootstrapAccordeon,BootstrapAccordeonItem}.vue
│   ├── modules/
│   │   ├── common/{streamdeck.js, sonosController.js, sonosService.js, sonosErrors.js, sdConnect.js, coordinatorResolver.js, uriTaxonomy.js, xml.js, timers.js}
│   │   ├── actions/{sonosActions.js, helpers.js}  # All 11 action handlers + state functions (Phase 5)
│   │   ├── plugin/{operationalStatus.js, SonosSpeakers.js, pollingSupervisor.js, actionDispatcher.js, actionSettings.js, globalSettings.js, lifecycle.js, dialRotateDebouncer.js, renderDedupe.js, marquee.js}  # Phase 3 runtime
│   │   └── pi/{globalSettingsSchema.js, actionSettingsSchema.js}  # Pure PI persistence builders
│   └── scss/styles.scss            # @import "bootstrap/scss/bootstrap";
├── bin/bump-version.mjs            # ESM manifest version bumper (used by build_dev_incr)
├── tests/unit/                     # Vitest specs alongside source structure
├── .github/workflows/{main,brainch,releases}.yml
└── .claude/                        # Claude Code context (this directory)
```

The `com.r-teller.sonoscontroller.sdPlugin/` directory is build-time only — output of `vite build`, zipped by `streamdeck pack` into the final `.streamDeckPlugin` artifact. Git-ignored.

---

## Deployment

- **Hosting:** None. The plugin is distributed as a `.streamDeckPlugin` bundle that users download and double-click to install.
- **Distribution channel:** GitHub Releases (manual download). The manifest is Marketplace-compliant for a future Elgato Marketplace submission.
- **CI/CD:** GitHub Actions
  - `main.yml` — push/PR to `main`: install → format:check → lint → build → validate
  - `brainch.yml` — non-main branches: same pipeline (note: filename typo and `public.html` filter typo carried over from the existing repo — the rebuild should fix both)
  - `releases.yml` — on `release: created`: rewrites `public/manifest.json` `Version` to `<tag>.<run_number>`, builds, validates, packs, and uploads `.streamDeckPlugin` to the release
- **Environments:** local development only (no staging/prod servers)
- **Secrets:** None. The plugin transmits no data off the LAN. No Sonos OAuth, no analytics, no PII.

---

## Related Context Files

For deeper detail, see:
- **`backend.md`** — Plugin background internals: SD WebSocket client, action dispatcher, polling supervisor, Sonos SOAP layer
- **`frontend.md`** — Property Inspector: Vue components, conditional sections, settings persistence
- **`data-model.md`** — Speaker store shape, per-action and global settings schemas, URI taxonomy
- **`security.md`** — LAN-only model, no auth, supply-chain hygiene
- **`tests.md`** — Vitest + Playwright test pyramid, fixture corpus, E2E scenarios
