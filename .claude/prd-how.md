# Sonos Controller — Engineering Implementation Guide (HOW)

This document is a prescriptive walkthrough of *how* the `streamdeck-sonoscontroller` plugin was actually built. It is a companion to a separately-authored "what" PRD; product framing is intentionally omitted. Citations use `path:line` to point at the code that backs each claim.

---

## 1. Tech Stack & Rationale

The project name in `package.json:2` is `streamdeck-sonos-controller-vue`, `version 0.1.0`, `type: module`. This is an ESM-only Vite + Vue 3 SPA whose two HTML entries are loaded inside the Stream Deck application (the plugin runtime and the Property Inspector iframe).

### Runtime dependencies (`package.json:11-26`)

| Dep | Version | Used for |
|---|---|---|
| `@elgato/streamdeck` | `^1.2.0` | Only `EventEmitter` is consumed (`src/modules/common/streamdeck.js:1`). The official SDK's WebSocket client is **not** used — there is a hand-rolled `ws://localhost:<port>` wrapper instead. |
| `@mdi/font`, `@mdi/js` | `^7.1.96` | Pulled in but not visibly imported. The actual icons shipped on the Stream Deck keys come from the `material-design-icons` git submodule processed by `generateImages.sh` (ImageMagick), not from the npm packages. |
| `@popperjs/core` | `^2.11.8` | Bootstrap 5 dropdown/tooltip dependency for the Property Inspector. |
| `axios` | `^1.6.7` | Listed but not imported; `fetch` is used everywhere (`src/modules/common/sonosController.js:529`). Effectively dead weight. |
| `bootstrap` | `^5.3.2` | PI uses Bootstrap 5 layout/components (form-switch, accordion, alerts). Imported via `src/pi/main.js:5` and via `src/scss/styles.scss`. |
| `buffer` | `^6.0.3` | Polyfill for `Buffer` in the browser (used to base64 encode/decode favorite metadata and album art — `src/components/PiComponent.vue:191`, `src/modules/actions/sonosController.js:368`). |
| `core-js` | `^3.26.1` | Polyfill umbrella, imported transitively. |
| `fs` | `^0.0.1-security` | The dummy npm placeholder. Unused — appears to have been added by mistake. |
| `js-yaml` | `^4.1.0` | Not imported. Vestigial. |
| `nunjucks` | `3.2.4` | Not imported. Vestigial. |
| `snapsvg-cjs` | `^0.0.6` | Not imported. Vestigial. |
| `sonos` | `^1.14.1` | The Node `sonos` package is **not** imported in any built code; the plugin reimplements SOAP control directly (`SonosController` / `SonosService` classes). Probably present for the unimplemented `discovery` script (see §14). |
| `vue` | `^3.3.4` | UI framework for both `plugin.html` and `pi.html`. Composition API with `<script setup>` everywhere. |

### Dev dependencies (`package.json:27-44`)

| Dep | Version | Used for |
|---|---|---|
| `vite` | `^4.4.9` | Bundler. Multi-entry build outputs into `com.r-teller.sonoscontroller.sdPlugin/`. |
| `@vitejs/plugin-vue` | `^4.3.4` | SFC compilation. |
| `@elgato/cli` | `^1.0.1` | `streamdeck validate` / `streamdeck pack` invoked via the `validate` and `package` scripts (`package.json:9-10`). |
| `@modyfi/vite-plugin-yaml` | `^1.1.0` | Imported but currently commented out (`vite.config.js:5`). |
| `@rollup/plugin-json` | `^6.1.0` | Imported but commented out (`vite.config.js:4`). The `@manifest` alias loads `public/manifest.json` directly using Vite's built-in JSON support. |
| `@rushstack/eslint-patch`, `@vue/eslint-config-prettier`, `eslint`, `eslint-plugin-vue`, `babel-eslint` | various | ESLint pipeline — config in `.eslintrc.cjs:1-9`, ruleset is `vue/vue3-essential` + `eslint:recommended` + Prettier skip-formatting. |
| `prettier` | `^3.0.3` | Code formatting; print width 128 (`package.json:13`). |
| `rollup` | `^4.24.3` | Vite's bundling engine; pinned for plugin compat. |
| `sass` | `^1.68.0` | Compiles `src/scss/styles.scss`. That file is currently a 3-line `@import "bootstrap/scss/bootstrap";` (effectively the whole Bootstrap bundle). |
| `shx` | `^0.3.4` | Cross-platform shell for the `clean` script (`package.json:15`). |

### Framework choice

Vue 3 with the Composition API and `<script setup>` was picked. Both surfaces (background plugin `plugin.html`, Property Inspector `pi.html`) are full Vue apps that mount into `#app`. The plugin background is essentially a headless component (`PluginComponent.vue:1-4` renders only the literal text `Nothing to see here Plv4!` for visual debugging).

CSS approach: Bootstrap 5 with the dark theme set on the `<html>` element (`pi.html:3`). No custom design tokens; the SCSS file just re-exports Bootstrap.

---

## 2. Repository Layout

```
streamdeck-sonoscontroller/
├── package.json                    # Build/lint/format scripts, deps
├── vite.config.js                  # Multi-entry build → com.r-teller.sonoscontroller.sdPlugin/
├── plugin.html                     # Background plugin entry, mounts PluginComponent.vue
├── pi.html                         # Property Inspector entry, mounts PiComponent.vue
├── generateImages.sh               # Bash + ImageMagick → public/images/{actions,keys,category}.png
├── .eslintrc.cjs                   # Vue3-essential + Prettier passthrough
├── .gitmodules                     # Pulls marella/material-design-icons submodule
├── material-design-icons/          # Submodule providing svg/outlined/*.svg source icons
├── public/
│   ├── manifest.json               # Stream Deck plugin manifest (UUIDs, actions, OS, encoder layouts)
│   ├── images/
│   │   ├── sonos.png / sonos@2x.png            # Plugin icon
│   │   ├── category.png / category@2x.png      # Category icon
│   │   ├── plugin/plugin.png (and @2x)         # Splash icon
│   │   ├── actions/<name>.png (and @2x)        # PI/category list icons
│   │   └── keys/<name>.png (and @2x)           # On-device key images
│   └── layouts/
│       ├── encoder-audio-equalizer.json        # SD+ icon-only layout
│       ├── encoder-bar-0-100.json              # Volume bar layout (subtype 2)
│       └── encoder-gbar-10-10.json             # Bass/Treble bipolar gradient bar (subtype 3, -10..10)
├── src/
│   ├── plugin/main.js              # Mounts PluginComponent into #app for plugin.html
│   ├── pi/main.js                  # Mounts PiComponent into #app + imports bootstrap JS + scss
│   ├── components/
│   │   ├── PluginComponent.vue     # All plugin-side wiring (SD socket, action dispatch, polling loop)
│   │   ├── PiComponent.vue         # Full PI UI: speaker selection, settings, global discovery save
│   │   ├── SonosSelection.vue      # <select size=5> with text filter, v-model UUID
│   │   └── accordeon/
│   │       ├── BootstrapAccordeon.vue       # Slot wrapper around .accordion
│   │       └── BootstrapAccordeonItem.vue   # Header + collapse item, supports forceExpanded prop
│   ├── modules/
│   │   ├── common/
│   │   │   ├── streamdeck.js               # Hand-rolled Stream Deck WS client (StreamDeck class)
│   │   │   ├── sonosController.js          # SOAP over HTTP client to port 1400 (SonosController + SonosService)
│   │   │   ├── timers.js                   # Web Worker–backed setTimeout/setInterval shim (avoids throttling)
│   │   │   └── utils.js                    # Entirely commented out (legacy XML parser)
│   │   ├── actions/
│   │   │   └── sonosController.js          # All action + state handler functions (~1758 lines)
│   │   ├── plugin/
│   │   │   └── SonosSpeakers.js            # Reactive speaker store keyed by UUID (singleton-ish)
│   │   └── pi/
│   │       └── SonosSpeaker.js             # POJO model used by PI dropdown
│   └── scss/
│       └── styles.scss             # @import "~bootstrap/scss/bootstrap";
├── doc/                            # PNG screenshots referenced in README
├── .github/workflows/
│   ├── main.yml                    # CI on push/PR to main: install/format/lint/build/validate
│   ├── brainch.yml                 # CI on non-main branches (typo: "brainch")
│   └── releases.yml                # On release: rewrites manifest Version, builds, packs .streamDeckPlugin
└── README.md                       # User-facing install + features overview
```

The `com.r-teller.sonoscontroller.sdPlugin/` directory is build-time only — it is the output of `vite build` and is what the `@elgato/cli pack` command zips into the final `.streamDeckPlugin` artifact. It is git-ignored (`.gitignore` line `com.r-teller.sonos*`).

---

## 3. Build & Packaging Pipeline

### Vite multi-entry config (`vite.config.js`)

```js
build: {
  outDir: 'com.r-teller.sonoscontroller.sdPlugin',
  rollupOptions: {
    input: { pi: "pi.html", plugin: "plugin.html" },
  },
},
base: "./",
```

Both `plugin.html` and `pi.html` live in the **repo root** (not in `public/`) so Vite treats them as entry HTML documents. Output goes into `com.r-teller.sonoscontroller.sdPlugin/` — that exact directory name is required by the `streamdeck` CLI which expects `<UUID>.sdPlugin/` (matches `manifest.json:2` `UUID: com.r-teller.sonoscontroller`).

Path aliases (`vite.config.js:21-27`):
- `@` → `./src`
- `~bootstrap` → `node_modules/bootstrap`
- `@manifest` → `./public/manifest.json` (consumed by `PiComponent.vue:193` to look up action state metadata at runtime)

`base: "./"` is important — Stream Deck loads the plugin via `file://`-relative paths inside its embedded webview, so all asset URLs must be relative.

`public/` is Vite's static directory and is copied verbatim into the build output, which is how `manifest.json`, `layouts/*.json`, and all `images/**/*.png` end up inside `com.r-teller.sonoscontroller.sdPlugin/`.

### npm scripts (`package.json:6-16`)

| Script | Purpose |
|---|---|
| `dev` | `vite` dev server. Of limited use because the Stream Deck app cannot consume the dev server. |
| `discovery` | `node src/discovery.js` — **the file does not exist** in the repo. Stub in package.json. |
| `build` | `vite build` — minified production build. |
| `build_dev` | Build with inline sourcemaps and no minification (debugging inside the Stream Deck webview). |
| `build_dev_incr` | Auto-bumps the 4th segment of `manifest.json` `Version` (e.g. `99.99.99.33` → `99.99.99.34`) using an inline Node script, then `build_dev`. Lets you reload the plugin without manual version bumps. |
| `validate` | `streamdeck validate --no-update-check ./com.r-teller.sonoscontroller.sdPlugin` — runs Elgato CLI's manifest/asset checker. |
| `package` | `streamdeck pack --no-update-check -f ./com.r-teller.sonoscontroller.sdPlugin` — zips into `com.r-teller.sonoscontroller.streamDeckPlugin`. |
| `preview` | Vite preview. |
| `lint` | ESLint with autofix on `.vue,.js,.jsx,.cjs,.mjs`. |
| `format` / `format:check` | Prettier with `--print-width 128`. CI fails on uncommitted format diffs. |
| `clean` | `shx rm -rf` the build dir and `.streamDeckPlugin` artifact. |

### `generateImages.sh`

A Bash script (~200 lines, `generateImages.sh:1-216`) that turns SVGs from the `material-design-icons` submodule into PNG bitmaps for both the on-device key surface and the action picker.

Inputs:
- `SRC=./material-design-icons/svg/outlined` (the `outlined` variant is hardcoded at `generateImages.sh:3`)
- Per-icon name mappings hardcoded at the bottom of the script (e.g. `key volume_off muted`, `key motion_photos_pause paused`, `action skip_next next_track`).

Outputs:
- `./public/images/actions/<name>.png` and `<name>@2x.png` — 20px / 40px, color `#d8d8d8` on transparent (used as PI list icons).
- `./public/images/keys/<name>.png` and `<name>@2x.png` — 72px / 144px, color `#000000` on `#d8a158` (Sonos amber) background, masked to a 14px-radius rounded square.
- `./public/images/category.png` and `category@2x.png` — 28px / 56px, color `#c8c8c8`.

Image processing uses ImageMagick `convert` exclusively. The script defines `mask`, `action`, `category`, `key`, `generateKeyIcon`, `overlay_icon`, and `overlay_icon_above` functions. `overlay_icon_above` is used to create the `repeat_one` and `shuffle_one` keys by stamping the `looks_one` glyph above the base icon (`generateImages.sh:140-154`).

This script is **not** wired into the Vite or CI build — it is run manually whenever a new icon is needed. The generated PNGs are committed to git under `public/images/`.

### GitHub Actions

Three workflows under `.github/workflows/`:

**`main.yml`** — triggered on push/PR to `main` and `workflow_dispatch`. Steps: `actions/checkout@v2` → `actions/setup-node@v2.1.4` → `npm install` → `npm run format:check` (fails build with explicit "❌ Code formatting issues found" message) → `npm run lint` → `npm run build` → `npm run validate`. No artifact is uploaded.

**`brainch.yml`** — same pipeline as `main.yml`, but only on push to non-main branches and only when files under `src/`, `public/`, `pi.html`, `public.html` (typo — should be `plugin.html`), `package.json`, or `vite.config.js` change.

**`releases.yml`** — triggered on `release: created`. Uses `jossef/action-set-json-field@v1` to rewrite `public/manifest.json` `Version` to `<tag>.<run_number>` (e.g. tag `1.2.3` + run 47 → `1.2.3.47`), then runs `npm install`, `npm run build`, `npm run validate`, `npm run package`. Finally uploads `com.r-teller.sonoscontroller.streamDeckPlugin` to the release using `actions/upload-release-asset@v1` with content-type `application/zip`.

---

## 4. Stream Deck Plugin Manifest (`public/manifest.json`)

Top-level fields (verbatim values):

- `UUID: "com.r-teller.sonoscontroller"` — also dictates the `.sdPlugin` output directory name.
- `Name: "Sonos Controller"`, `Author: "Robert Teller"`, `Description: "Control Sonos devices using Stream Deck"`.
- `URL: "https://github.com/r-teller/streamdeck-sonoscontroller"`.
- `Version: "99.99.99.33"` — placeholder; `releases.yml` rewrites this on release.
- `Icon: "images/sonos"`, `CategoryIcon: "images/category"`, `Category: "Sonos Controller"` (note the icons are referenced without `.png`; Stream Deck appends the extension and picks the @2x variant on retina).
- `CodePath: "plugin.html"` — Stream Deck loads this HTML in a Node-enabled webview.
- `SDKVersion: 2`.
- `Software: { MinimumVersion: "6.5" }` — requires the SD+ generation that introduced `Encoder` / `setFeedback`.
- `OS`: `[{Platform: "mac", MinimumVersion: "10.11"}, {Platform: "windows", MinimumVersion: "10"}]`.
- `Nodejs: { Version: "20", Debug: "enabled" }` — runs the plugin in a Node 20 host with debugger attached. (Despite this being a Node manifest, the actual code runs as a browser-style webview because the entry is an HTML file.)

### Action catalog (`public/manifest.json:2-247`)

All eleven actions share `PropertyInspectorPath: "pi.html"`, `UserTitleEnabled: false` (except `play-sonos-favorite`), `DisableAutomaticStates: true`, and `DisableCaching: true` (except `play-sonos-favorite` which is `false`). All except the equalizer are `Controllers: ["Keypad"]`.

| Action UUID | States | Notes |
|---|---|---|
| `com.r-teller.sonoscontroller.currently-playing` | `Currently_Playing` | Title alignment top, fontsize 11. Used as a manual refresh button. |
| `com.r-teller.sonoscontroller.toggle-mute-unmute` | `Unmuted`, `Muted` | Two-state. |
| `com.r-teller.sonoscontroller.toggle-play-pause` | `Paused`, `Playing`, `Stopped` | Three-state. |
| `com.r-teller.sonoscontroller.toggle-play-mode` | `Normal`, `Shuffle_NoRepeat`, `Shuffle_Repeat_One`, `Shuffle`, `Repeat_One`, `Repeat_All` | Six-state, title alignment **bottom**. |
| `com.r-teller.sonoscontroller.toggle-input-source` | `Sonos_Queue`, `TV_Input`, `Line_In` | Three-state. |
| `com.r-teller.sonoscontroller.play-next-track` | `Next_Track` | One-state. |
| `com.r-teller.sonoscontroller.play-previous-track` | `Previous_Track` | One-state. |
| `com.r-teller.sonoscontroller.volume-up` | `Volume_Up` | One-state. |
| `com.r-teller.sonoscontroller.volume-down` | `Volume_Down` | One-state. |
| `com.r-teller.sonoscontroller.play-sonos-favorite` | `Play Favorite` | `UserTitleEnabled: true`, `DisableCaching: false` so album art persists. |
| `com.r-teller.sonoscontroller.encoder-audio-equalizer` | `Audio Equalizer` | `Controllers: ["Encoder"]`, with `Encoder.layout: "layouts/encoder-audio-equalizer.json"` and `Encoder.TriggerDescription.Rotate: "Equalizer"`. |

### Encoder layouts (`public/layouts/`)

- `encoder-audio-equalizer.json` — minimal pixmap-only layout, 48×48 icon at `[16,40]`. This is the **default** layout assigned at action-construction time.
- `encoder-bar-0-100.json` — title (top), icon, value (right-aligned, fontsize 24), and a `bar` indicator (`subtype: 2`) ranged `0..100`. Used while editing volume.
- `encoder-gbar-10-10.json` — same anatomy with a gradient bar (`subtype: 3`, `bar_bg_c: "0:#ff0000,0.5:yellow,1:#00ff00"`) ranged `-10..10`. Used while editing bass/treble.

The plugin swaps layouts at runtime (see §6) by sending `setFeedbackLayout` from `encoder_audio_equalizer_state` (`src/modules/actions/sonosController.js:1374-1436`).

---

## 5. Stream Deck SDK Integration

### The custom WebSocket client (`src/modules/common/streamdeck.js`)

The official `@elgato/streamdeck` SDK is **not** used as a runtime client. Only its `EventEmitter` is imported (line 1). Everything else is a hand-rolled WebSocket wrapper:

```js
this.streamDeckWebsocket = new WebSocket("ws://localhost:" + inPort);
this.streamDeckWebsocket.onopen = () => {
  this.streamDeckWebsocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPropertyInspectorUUID }));
  this.events.emit("connected", actionInfo);
};
```
(`src/modules/common/streamdeck.js:9-17`)

The Stream Deck app calls `window.connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo)` once the page loads. That global is defined in:
- `PluginComponent.vue:113` (plugin side, always passes literal `"{}"` for `actionInfo`)
- `PiComponent.vue:251` (PI side, passes the real `actionInfo` blob)

The constructor instantiates `EventEmitter`, opens the socket, sends the register frame, then registers a single `onmessage` handler that switches on `incomingEvent.event` and re-emits each Stream Deck event under the same name (`streamdeck.js:21-82`). Events handled: `didReceiveGlobalSettings` (re-emitted as `globalsettings`), `deviceDidConnect`, `deviceDidDisconnect`, `keyDown`, `keyUp`, `dialDown`, `dialUp`, `dialRotate`, `touchTap`, `systemDidWakeUp`, `willAppear`, `willDisappear`, `didReceiveSettings`, `sendToPlugin`, `sendToPropertyInspector`, `propertyInspectorDidAppear`, `propertyInspectorDidDisappear`, `titleParametersDidChange`. Anything else logs `Unhandled Event: <name>`.

### Outgoing message helpers

The class exposes thin wrappers that build the Stream Deck JSON envelope and `send()` it:

| Method | Stream Deck event |
|---|---|
| `requestGlobalSettings()` | `getGlobalSettings` |
| `saveGlobalSettings({payload})` | `setGlobalSettings` |
| `getSettings({context})` | `getSettings` |
| `saveSettings({actionSettings, context})` | `setSettings` |
| `setTitle({context, title})` | `setTitle` (target=0, both states) |
| `logMessage({messageText})` | `logMessage` |
| `setImage({context, image, state})` | `setImage` |
| `setFeedback({context, payload})` | `setFeedback` (SD+) |
| `setFeedbackLayout({context, payload})` | `setFeedbackLayout` (SD+) |
| `showAlert({context})` | `showAlert` |
| `showOk({context})` | `showOk` |
| `setState({context, stateIndex})` | `setState` |
| `sendToPlugin({context, payload})` | `sendToPlugin` (note: also sets `action: this.propertyInspectorUUID` — see §7 caveat) |
| `sendToPropertyInspector({context, payload})` | `sendToPropertyInspector` |

The plugin background never sends `setSettings` for itself — only the PI does. The plugin only updates state via `setState`, `setImage`, `setTitle`, `setFeedback`, `setFeedbackLayout`, `showAlert`. It writes `setGlobalSettings` only via the PI's "Save and Connect" button.

---

## 6. Action Implementation Pattern

### Dispatcher

`PluginComponent.vue` is the entire plugin. On mount it defines `window.connectElgatoStreamDeckSocket` (`PluginComponent.vue:113`), instantiates `StreamDeck`, and registers handlers. The "registry" of action behavior is the `actionFunctionMap` literal (`PluginComponent.vue:29-109`) keyed by the **last segment** of the action UUID (e.g. `"toggle-mute-unmute"`). Each entry has:

```js
{
  keyDown:   [actionFn1, actionFn2, ...],   // or dialRotate / dialDown
  state: { default: stateFn, keypad: …, encoder: … },
}
```

`callAction({inContext, inEvent, inRotation})` (`PluginComponent.vue:335-386`) extracts the action name from `actionSettings.value[inContext].action.split(".").pop()`, looks up the matching map entry, fetches the speaker for the context, sets `OPERATIONAL_STATUS.UPDATING`, awaits the action function, and on success calls `sonosSpeakers.updateSpeakerState({UUID, state: result.updatedSonosSpeakerState})`. On failure it emits `showAlert` to every context attached to that speaker and sets `OPERATIONAL_STATUS.DISCONNECTED`.

### Lifecycle hooks consumed

- `willAppear` — initialize `actionSettings[context]` with `{...payload.settings, currentStateIndex: payload.state || 0}`, register the context with the appropriate speaker (`PluginComponent.vue:120-147`).
- `willDisappear` — delete the context's settings and remove it from the speaker; if last context, remove the speaker (`PluginComponent.vue:155-173`).
- `didReceiveSettings` — re-cache settings; if the user switched the bound speaker UUID via PI, `moveContext` from old → new (`PluginComponent.vue:176-219`).
- `keyDown`, `dialDown`, `touchTap` — call `callAction` directly.
- `dialRotate` — accumulates `payload.ticks` per context into `rotationAmount[context]` and debounces with a 300 ms timeout (`tickBucketSizeMs`) before dispatching, so rapid rotations are coalesced into a single SOAP call (`PluginComponent.vue:222-249`).
- `keyUp` and `dialUp` are explicitly *not* handled (`PluginComponent.vue:256, 264`).
- `globalsettings` — caches `globalSettings.value` and updates poll/timeout values.

### Polling loop (`PluginComponent.vue:272-331`)

A `setInterval(..., 500ms)` walks every speaker UUID and, when the speaker is not currently `UPDATING`/`RATE_LIMITED` and `secondsLastChecked >= deviceCheckInterval` (default 10 s, configurable via global settings), constructs a fresh `SonosController`, races `getDeviceInfo()` against a `deviceTimeoutDuration * 1000` ms timeout, and stores the result via `sonosSpeakers.updateSpeakerState(..., updateLastChecked: true)`. On exception every context attached to that speaker gets `showAlert` and the speaker flips to `DISCONNECTED`.

After the speaker fetch, if the resulting `operationalStatus === UPDATED`, the loop fans out to `refreshStateAndTitle({inContext, inSonosSpeakerState})` for every context (`PluginComponent.vue:319-329`).

`refreshStateAndTitle` (`PluginComponent.vue:388-419`) selects the controller-specific state handler (`controller.toLowerCase()` matches `keypad` or `encoder`, falling back to `default`), invokes it, and if `stateResult.futureStateIndex !== currentStateIndex` updates `actionSettings[context].currentStateIndex` so the next tick won't re-fire `setState` redundantly.

### Representative action — `toggle_mute_unmute_action` (`src/modules/actions/sonosController.js:427-479`)

```js
const sonosController = new SonosController();
sonosController.connect(inActionSettings.hostAddress);
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("Timeout toggling mute")), deviceTimeoutDuration * 1000));
const setMuteState = await Promise.race([sonosController.setMute(newMuteState), timeout]);
```

Every action follows this template: instantiate a fresh `SonosController`, `connect(host)`, race the SOAP call against a Promise-based timeout, return `{status: "SUCCESS", updatedSonosSpeakerState}` (a *projected* state — local merge of the previous state with the changed field) on success, or `{status: "ERROR"}` otherwise. The plugin then writes the projected state into the speaker store, so the next 500 ms tick re-renders the new state immediately without waiting for the next poll cycle to hit Sonos.

### Representative state — `encoder_audio_equalizer_state` (`src/modules/actions/sonosController.js:1349-1454`)

This is the only handler that uses `setFeedback` / `setFeedbackLayout`. Based on `inActionSettings.encoderAudioEqualizerTarget` (`VOLUME` | `BASS` | `TREBLE`), it conditionally calls `setFeedbackLayout` (only when `lastAudioEqualizerLayout` has changed) to swap between `encoder-bar-0-100.json` and `encoder-gbar-10-10.json`, then sends `setFeedback` with `{title, value, indicator}` payloads. It only fires when the target value has actually changed from `inActionSettings.status.lastAudioEqualizer{Volume,Bass,Treble}`, avoiding flicker.

### Marquee/title rendering — `updateStreamDeckStateAndTitle` (`src/modules/actions/sonosController.js:135-411`)

A 270-line helper that handles every combination of `displayMarqueeTitle`, `displayMarqueeAlbumTitle`, `displayStateBasedTitle`, and `displayAlbumArt`. It maintains scroll position state on `inActionSettings.marqueePositionTop` / `marqueePositionBottom` and rebuilds substrings each tick by padding the title to `marqueeWidth + 4` characters then sliding a window. Album art is fetched (`fetch(albumArtURI).then(r=>r.arrayBuffer())`), base64-encoded via `Buffer.from(buffer).toString("base64")`, and pushed via `setImage({image: "data:image/png;base64,..."})` (`src/modules/actions/sonosController.js:362-391`). Local `file://`-style URIs (`./images/keys/input_tv.png`) are passed straight through without fetch.

---

## 7. Property Inspector

### Entry & framework

`pi.html:13` mounts `src/pi/main.js`, which:
```js
import { createApp } from "vue";
import PiComponent from "@/components/PiComponent.vue";
import "../scss/styles.scss";
import * as bootstrap from "bootstrap";   // for collapse/dropdown JS
createApp(PiComponent).mount("#app");
```

The PI runs Bootstrap 5 in **dark theme** (`pi.html:3` `data-bs-theme="dark"`).

### Component tree

- `PiComponent.vue` — the entire screen.
  - `AccordeonComponent` (`BootstrapAccordeon.vue`) wrapping an `AccordeonItem` titled "Available Sonos Speakers" containing `<SonosSelection>` (`PiComponent.vue:6-15`).
  - `<SonosSelection>` (`SonosSelection.vue`) — `v-model` two-way binds to `sonosSpeaker` (UUID string). Renders a `<select size="5">` with text-filterable options. Emits `selection-saved` to trigger `saveSettings`.
  - Inline form-switch checkboxes (Bootstrap `form-check form-switch`) for `displayStateBasedTitle`, `displayMarqueeTitle`, `displayMarqueeAlbumTitle`, `displayAlbumArt`. Visibility is gated by per-action allow lists (`displayStateBasedTitleFor`, `displayMarqueeTitleFor`, `displayMarqueeAlbumTitleFor`, `displayAlbumArtFor` — `PiComponent.vue:225-244`).
  - Conditional `Play Mode(s)` checkboxes (`isTogglePlayMode`), `Input Source(s)` checkboxes (`isToggleInputSource`), `Equalizer Target` `<select>` (`isEncoderAudioEqualizer`), `Sonos Favorite(s)` `<select>` (`isPlaySonosFavorite`).
  - A second `AccordeonComponent` for the **Global Settings** (`PiComponent.vue:132-179`) — primary device IP, action timeout (sec), check interval (sec). The accordion item passes `:force-expanded="sonosConnectionState !== OPERATIONAL_STATUS.CONNECTED"` so the section auto-opens on first run when there are no devices to discover yet.
  - "Save and Connect" / "Save and Reconnect" button which fires `saveGlobalSettings` (`PiComponent.vue:391-431`).

### `BootstrapAccordeonItem.vue`

Wraps Bootstrap 5's accordion markup. It composes the collapse target id as `'collapse' + itemId` and the parent as `'#' + accordeonId`. The `forceExpanded` prop drives the `show`/`collapse` and `aria-expanded` attributes (`BootstrapAccordeonItem.vue:8-22`).

### PI ↔ plugin messaging

This codebase **does not use** `sendToPlugin` / `sendToPropertyInspector` for state synchronization. Both surfaces communicate exclusively through:
1. `setSettings` / `getSettings` — per-context action settings
2. `setGlobalSettings` / `getGlobalSettings` — shared `{devices, deviceCheckInterval, deviceTimeoutDuration, favorites}`

The PI saves settings; the plugin receives `didReceiveSettings` and reacts. This keeps everything serializable and avoids a second message channel.

`StreamDeck.sendToPlugin` is implemented (`streamdeck.js:206-215`) but never called in production code. There is also a quirk: it sets `action: this.propertyInspectorUUID`, but `propertyInspectorUUID` is actually the **context** UUID passed in at construction, not an action UUID — this would not behave correctly if invoked.

### How discovered speakers populate the dropdown

Trigger flow (`PiComponent.vue:391-431`):
1. User enters Primary Device IP → clicks "Save and Connect".
2. `new SonosController().connect(primaryDeviceAddress.value)`.
3. Race `$SONOS.getDevices({setAsPrimary: true})` against `deviceTimeoutDuration` timeout. This fetches the discovery device's `ZoneGroupTopology` and parses every `ZoneGroupMember` (and `Satellite`).
4. Race `$SONOS.getFavorites()` against the same timeout — populates `Sonos Favorites` selector for `play-sonos-favorite` actions.
5. `streamDeckConnection.value.saveGlobalSettings({payload: {devices, deviceCheckInterval, deviceTimeoutDuration, favorites}})`.
6. `refreshAvailableSonosSpeakers` constructs `SonosSpeaker` POJOs, sorts alphabetically by `title`, and assigns the model.

### How the selected speaker is persisted

When `<SonosSelection>` emits `selection-saved`, `saveSettings()` (`PiComponent.vue:433-461`) writes a flat object to per-context settings:
```js
{
  action, states, controller, uuid, title, hostAddress, zoneName,
  selectedPlayModes, selectedInputSources, encoderAudioEqualizerTarget,
  displayStateBasedTitle, displayAlbumArt, displayMarqueeTitle, displayMarqueeAlbumTitle,
  selectedSonosFavorite: { title, uri, metadata, albumArtURI } | null,
  adjustVolumeIncrement: number | null,  // volume-up / volume-down only; null → inherit global
}
```
Note that `metadata` is base64-decoded back to UTF-8 before persisting (`PiComponent.vue:453`) — it is base64-encoded when held in the dropdown options to avoid HTML attribute encoding issues, then decoded on save.

### Groupings

There is no group-management UI. Coordinator/group topology is parsed during `getDevices` for the purpose of resolving the per-device `Location` URL, but groups themselves are not exposed to the user. Local-transport switching uses the coordinator UUID via `setLocalTransport` (`src/modules/common/sonosController.js:279-283`).

---

## 8. Sonos Integration Layer (`src/modules/common/sonosController.js`)

### Discovery

There is **no SSDP, mDNS, or topology multicast**. Discovery is bootstrapped from a single user-provided "Primary Device" IPv4. The PI uses that to fetch `GetZoneGroupState` from the `ZoneGroupTopology` service and walks the resulting XML to extract every member (and satellite) — that becomes the static device list stored in global settings.

`getDevices({setAsPrimary})` (`sonosController.js:132-187`):
- Fetches `GetZoneGroupState`
- Converts XML → JSON via `convertXmlToJson` (`sonosController.js:444-503`)
- For each `ZoneGroupMember`, extracts `Location` (`http://<ip>:<port>/xml/device_description.xml`), and produces `{primary, hostAddress, port, zoneName, isSatellite, idleState, uuid}`. The `primary` boolean is set when `member.host === this.host && setAsPrimary`.

**XML→JSON shape normalization (PR #3).** `convertXmlToJson` returns a *plain object* for a single child element and *promotes to array* only when duplicate sibling keys exist. A household with exactly one zone group therefore returns `ZoneGroups.ZoneGroup` as an object, not an array, and a naive `for...of` throws `groups is not iterable`. Both `getDevices` and `getDeviceLocation` defensively wrap with `[].concat(jsonState?.ZoneGroups?.ZoneGroup || [])` (`sonosController.js:103, 158`) to coerce single-vs-many into a uniform iterable. The same normalization must be applied anywhere `ZoneGroupMember` or `Satellite` is iterated, since those collapse identically when there's a single child.

### Transport — SOAP over HTTP to port 1400

The SOAP client is the `SonosService` class (`sonosController.js:506-555`). It builds a UPnP envelope, POSTs to `http://${host}:1400/${baseUrl}/Control` with header `SOAPAction: "urn:schemas-upnp-org:service:${name}:1#${action}"`, then parses the response with `DOMParser` and flattens `Body > * > *` into a `{nodeName: textContent}` dict.

Service endpoints registered by `SonosController.constructor` (`sonosController.js:49-56`):
| Property | Service name | URL prefix |
|---|---|---|
| `audioIn` | `AudioIn` | `AudioIn/Control` |
| `avTransport` | `AVTransport` | `MediaRenderer/AVTransport/Control` |
| `deviceProperties` | `DeviceProperties` | `DeviceProperties/Control` |
| `renderingControl` | `RenderingControl` | `MediaRenderer/RenderingControl/Control` |
| `zoneGroupTopology` | `ZoneGroupTopology` | `ZoneGroupTopology/Control` |
| `contentDirectory` | `ContentDirectory` | `MediaServer/ContentDirectory/Control` |

### Subscriptions / event model

There are **no UPnP NOTIFY subscriptions**. Every state update is **polling-based**:
- 500 ms interval in `PluginComponent.vue:272` decides which speakers are due.
- A speaker is fetched when `secondsLastChecked >= deviceCheckInterval` (default 10 s).
- Each fetch concurrently issues 7 SOAP calls via `Promise.all` (`sonosController.js:191-200`):
  - `GetTransportSettings`, `GetTransportInfo`, `GetMute`, `GetVolume`, `GetBass`, `GetTreble`, `GetPositionInfo` (and optionally `GetQueue` if `getQueue=true`).

### Data models

| Model | Location | Shape |
|---|---|---|
| Speaker (plugin store) | `SonosSpeakers` reactive map (`src/modules/plugin/SonosSpeakers.js:86`) | `{contexts: string[], operationalStatus, state, updateAttempts: number[], lastChecked, lastUpdated}` |
| Speaker State | JSDoc at `SonosSpeakers.js:67-75` | `{audioEqualizer:{bass,treble,volume}, playMode, playbackState, currentURI, muted, playing?, queue?}` |
| PlayingInfo | `SonosSpeakers.js:38-48` | `{position, elapsedSec, durationSec, currentTrack, title, artist, album, albumArtURI}` |
| Queue / QueueItem | `SonosSpeakers.js:50-64` | `{start, count, list: [{title, artist, album, uri, albumArtURI}]}` |
| Favorite | constructed in `getFavorites` (`sonosController.js:387-408`) | `{title, uri, metadata, albumArtURI}` |
| Device record (global settings) | `getDevices` result (`sonosController.js:138-155`) | `{primary, hostAddress, port, zoneName, isSatellite, idleState, uuid}` |
| PI dropdown POJO | `src/modules/pi/SonosSpeaker.js:1-13` | `{zoneName, hostAddress, title, uuid}` (title formatted as `"<zoneName> (<host>) [🛰️]"`) |

There is no `Group` or `Coordinator` first-class type. Coordinators are extracted ad-hoc inside `setLocalTransport` (`sonosController.js:281`).

### Per-action SOAP commands

| Action | SOAP call | File:line |
|---|---|---|
| Play / Pause | `AVTransport#Play(Speed=1)` / `Pause` | `sonosController.js:66-72` |
| Next / Prev | `AVTransport#Next` / `Previous` | `sonosController.js:74-80` |
| Mute toggle | `RenderingControl#SetMute(Channel=Master, DesiredMute=0|1)` | `sonosController.js:292-297` |
| Volume up/down | `RenderingControl#SetVolume(Channel=Master, DesiredVolume=N)` | `sonosController.js:321-326`, callers at `actions/sonosController.js:1099-1142`. **Increment resolution (PR #4):** `parseInt(inActionSettings.adjustVolumeIncrement) \|\| globalAdjustVolumeIncrement`. The per-action override takes precedence; otherwise the global default (default 10, min 1) is used. No hardcoded fallback remains — the global value is always passed by `PluginComponent.callAction` (`PluginComponent.vue:368`). Manifest tooltips updated to `"Increase volume"` / `"Decrease volume"` (no numeric claim). |
| Bass / Treble | `RenderingControl#SetBass(DesiredBass=N)` / `SetTreble` | `sonosController.js:303-315`. Range clamped to `[-10, 10]` in the encoder action. |
| Play Mode | `AVTransport#SetPlayMode(NewPlayMode=NORMAL|SHUFFLE|...)` | `sonosController.js:275-277` |
| Input Source | `AVTransport#SetAVTransportURI` indirectly via `setLocalTransport(prefix, suffix)` which builds e.g. `x-rincon-stream:RINCON_xxx` | `sonosController.js:279-290` |
| Play Favorite | `AVTransport#RemoveAllTracksFromQueue` → `setServiceURI` (`AddURIToQueue` + `SetAVTransportURI` to `x-rincon-queue:<coord>#0` + `Seek(TRACK_NR)`) → `Play` | `sonosController.js:81-83, 335-353; actions/sonosController.js:1468-1540` |
| Browse Favorites | `ContentDirectory#Browse(ObjectID=FV:2, BrowseFlag=BrowseDirectChildren)` | `sonosController.js:387-408` |
| Get Queue | `ContentDirectory#Browse(ObjectID=Q:0)` | `sonosController.js:410-431` |

### URI taxonomy

Documented in comments at `sonosController.js:18-47`:
- `x-sonos-spotify:` — Spotify track
- `x-sonos-htastream:RINCON_xxx:spdif` — TV input
- `x-rincon-stream:RINCON_xxx` — Line-in
- `x-rincon-queue:RINCON_xxx` — Sonos queue
- `x-sonos-http:` — Sonos Radio
- `x-sonosapi-stream:` — broadcast (handled specially in `setServiceURI`)

`getInputSourceMappings(uri)` (`actions/sonosController.js:91-123`) detects the current source from the URI prefix/suffix and returns prefix/suffix factories so the toggle can construct the next URI.

### Group management

Not implemented — the PI never lets the user change group membership. `setLocalTransport` always targets the coordinator of the **first** `ZoneGroup` returned (`sonosController.js:281`), so behavior in multi-group households is undefined.

---

## 9. State Management

`SonosSpeakers` (`src/modules/plugin/SonosSpeakers.js`) is the single source of truth for speaker state inside the plugin process. It uses Vue's `reactive({})` (`SonosSpeakers.js:86`) so state mutations propagate naturally — although in practice `PluginComponent.vue` doesn't render anything, so reactivity is mostly used as a convenient mutable map.

A single instance is created at module scope: `const sonosSpeakers = new SonosSpeakers();` (`PluginComponent.vue:111`). All action handlers receive contexts and look up speakers via the same instance. Multiple action contexts pointing at the same speaker UUID are tracked in `speakers[UUID].contexts: string[]` so a state refresh fans out to every relevant key/dial.

### Operational status enum (`SonosSpeakers.js:4-12`)

`UNINITIALIZED` → `UPDATING` → `UPDATED` → ... or → `DISCONNECTED` / `RATE_LIMITED`.

### Rate limiting

`getSpeaker({UUID})` (`SonosSpeakers.js:129-167`) tracks `updateAttempts: number[]` (epoch seconds). If more than `maxUpdates = 3` `UPDATING` transitions happen inside `timeWindow = 10` seconds, the speaker is forcibly flipped to `RATE_LIMITED`. The 500 ms poll loop in `PluginComponent.vue:280-284` then skips that speaker until the window decays. `setOperationalStatus({UUID, operationalStatus: "UPDATING"})` pushes the timestamp; `UPDATED` resets the window.

`actionSettings` is a per-context dict held inside `PluginComponent.vue:16` — it is not reactive in any meaningful way (the component renders no UI), but the same object is read/written from many code paths so storing it on the component is a lightweight singleton.

`globalSettings` (`PluginComponent.vue:15`) is hydrated from `didReceiveGlobalSettings` and contains `{devices, deviceCheckInterval, deviceTimeoutDuration, favorites}`.

---

## 10. Image / Icon Generation

Source: `material-design-icons` git submodule pointed at `https://github.com/marella/material-design-icons` (`.gitmodules:1-3`). The script reads from `material-design-icons/svg/outlined/<name>.svg` (`generateImages.sh:21`).

Sizes generated:
- **Action icons** (PI list): 20×20 (`@1x`) and 40×40 (`@2x`), color `#d8d8d8`, transparent background.
- **Key icons** (on-device button face): 72×72 and 144×144. Icon glyph is 40 px (or 80 px @2x) centered on a `#d8a158` (Sonos amber) background, then masked through a `roundrectangle` to a 14 px corner radius.
- **Category icon**: 28×28 and 56×56, color `#c8c8c8`.
- **Overlay icons** (e.g. `repeat_one`, `shuffle_one`): a smaller `looks_one` glyph composited above the main icon at one-eighth-of-padding north offset (`generateImages.sh:91-130`).

`manifest.json` references icons **without extensions** — Stream Deck appends `.png` and selects the `@2x` variant on retina displays. References:
- `Icon: "images/sonos"`, `CategoryIcon: "images/category"` (top-level)
- `Actions[].Icon: "images/actions/<name>"` — used in the PI sidebar list
- `Actions[].States[].Image: "images/keys/<name>"` — used as the on-device button face

The script is run manually; outputs are committed.

---

## 11. Configuration & Settings Persistence

### Per-action settings (`setSettings` / `didReceiveSettings`)

Schema written by `PiComponent.saveSettings` (`PiComponent.vue:433-461`):
```ts
{
  action: string,                      // full UUID, e.g. "com.r-teller.sonoscontroller.toggle-mute-unmute"
  states: ManifestStates[],            // copy of manifest States so the plugin doesn't have to re-read manifest
  controller: "Keypad" | "Encoder",
  uuid: string,                        // bound Sonos speaker UUID (RINCON_xxx)
  title: string,                       // "<zone> (<host>)"
  hostAddress: string,                 // IPv4
  zoneName: string,
  selectedPlayModes: string[],         // for toggle-play-mode only
  selectedInputSources: string[],      // for toggle-input-source only
  encoderAudioEqualizerTarget: "VOLUME" | "BASS" | "TREBLE",
  displayStateBasedTitle: boolean | null,
  displayAlbumArt: boolean | null,
  displayMarqueeTitle: boolean | null,
  displayMarqueeAlbumTitle: boolean | null,
  selectedSonosFavorite: { title, uri, metadata, albumArtURI } | null,
  adjustVolumeIncrement: number | null,  // volume-up / volume-down only; null → inherit global
}
```
Plus the plugin-managed transient fields written by `updateStreamDeckStateAndTitle` (`actions/sonosController.js:155, 187, 244`): `currentStateIndex`, `marqueePositionTop`, `marqueePositionBottom`, and a nested `status: { titleLastUpdated, lastTitleValue, lastCustomTitle, lastPlayingTitle, marqueeTitleTopValue, marqueeTitleBottomValue, albumArtURILastValue, lastAudioEqualizer{Bass,Treble,Volume}, lastAudioEqualizerLayout }`.

The plugin **also** writes back to per-context settings (because `actionSettings.value[context]` is mutated and pushed via implicit Stream Deck behavior). However there is no explicit `saveSettings` from the plugin side — the settings stay in memory until the next `willAppear`.

`PiComponent.saveSettings` (`PiComponent.vue:491`) writes `adjustVolumeIncrement: perButtonAdjustVolumeIncrement.value ?? null` so a deliberately-cleared field round-trips as `null`. Use `??` (not `||`) when reading in the action handler so `1` is not treated as falsy and silently replaced with the global default.

### Global settings (`setGlobalSettings`)

Schema written by `PiComponent.saveGlobalSettings` (`PiComponent.vue:418-425`):
```ts
{
  devices: { [uuid: string]: { primary, hostAddress, port, zoneName, isSatellite, idleState, uuid } },
  deviceCheckInterval: number,    // default 10 (sec)
  deviceTimeoutDuration: number,  // default 5 (sec)
  adjustVolumeIncrement: number,  // default 10, min 1; clamped at write via Math.max(1, value)
  favorites: { title, uri, metadata, albumArtURI }[],
}
```

### Defaults / migration

There is no explicit migration code. Defaults are sprinkled at use sites (e.g. `displayMarqueeTitle ?? false`, `marqueeWidth || 10`). The global `adjustVolumeIncrement` is hydrated with `?? 10` in both `PiComponent.vue:308` and `PluginComponent.vue:154` so an upgrade from a settings blob without the field falls through to the historical default. `PiComponent.saveGlobalSettings` clamps with `Math.max(1, value)` before persisting (`PiComponent.vue:459`) because the HTML `min="1"` attribute is bypassable in the Electron webview's `v-model.number` binding. The README states default check interval = 10 s and default action timeout = 5 s, matching `PiComponent.vue:198-199`.

---

## 12. Error Handling, Logging, Debugging

- All errors are surfaced to the user as Stream Deck **alert glyphs** via `streamDeckConnection.showAlert({context})` (`PluginComponent.vue:311, 375`).
- All exceptions are caught and `console.error`'d with a `[Function Name]` prefix (e.g. `[Toggle Mute/Unmute Action] Error toggling Sonos mute state for context ...`). These logs go to the Stream Deck plugin log directory because `manifest.json` sets `Nodejs.Debug: "enabled"`.
- The plugin returns `{status, completed, message}` envelopes from every action so callers can branch on result without inspecting exceptions.
- There is no debug flag; verbose logging is always on. `console.log` calls fire on `didReceiveSettings`, `removeContext`, "no primary device found", etc.

For interactive debugging the developer is expected to:
1. `npm run build_dev_incr` (auto-bumps the manifest version + inline sourcemaps + no minify).
2. Reload the plugin in the Stream Deck app.
3. Open the Chromium devtools attached to the plugin webview (Stream Deck exposes this via the Stream Deck app's Plugins menu).

---

## 13. Testing

### 13.1 Current state

There are **no automated tests** in the repository. No `test`/`spec` directory, no Vitest/Jest/Playwright config in `package.json`, no `npm test` script. CI (`.github/workflows/*.yml`) runs `format:check`, `lint`, `build`, and `validate` only — `validate` shells the Elgato `DistributionTool` to lint the produced `.streamDeckPlugin` bundle, not the JS.

The sections below prescribe the test pyramid that should be added. Recommended runner is **Vitest** (zero-config under Vite, shares the existing `vite.config.js` resolver and ESM handling). Recommended browser-automation layer is **Playwright** for PI rendering (`pi.html` is a normal SPA) and a **headless `streamdeck-mock` harness** for the plugin-side WebSocket protocol.

### 13.2 Unit tests (`tests/unit/`)

Pure-function and class-isolated tests. No network, no DOM, no Stream Deck. Goal: deterministic and fast (< 2 s suite).

| Target | File under test | What to assert |
|---|---|---|
| SOAP envelope construction | `src/modules/common/sonosController.js` (`SonosService.execute`) | For every action (Play, Pause, SetVolume, SetMute, SetPlayMode, SetAVTransportURI, Seek, Browse, GetZoneGroupState, GetTransportInfo, GetMute, GetVolume, GetBass, GetTreble, GetPositionInfo, RemoveAllTracksFromQueue, AddURIToQueue, SetBass, SetTreble): expected URL (`http://<host>:1400/<prefix>/Control`), `SOAPAction` header value, body XML matches a snapshot. Mock `globalThis.fetch`. |
| XML→JSON converter | `convertXmlToJson` (`sonosController.js:444-503`) | Single-child element returns object (regression for PR #3). Multiple siblings of the same tag return array. Mixed-content nodes preserve `_text`. CDATA payloads survive round-trip. |
| ZoneGroup normalization | `getDevices`, `getDeviceLocation` | Given a fixture with one `ZoneGroup`, returns iterable of length 1. Given a fixture with three `ZoneGroup`s, returns iterable of length 3. Given missing `ZoneGroups`, returns empty iterable (no throw). |
| URI taxonomy | `getInputSourceMappings(uri)` (`actions/sonosController.js:91-123`) | Each documented prefix (`x-sonos-spotify:`, `x-sonos-htastream:`, `x-rincon-stream:`, `x-rincon-queue:`, `x-sonos-http:`, `x-sonosapi-stream:`) maps to the right source name and prefix/suffix factories produce the expected next-URI given a coordinator UUID. |
| Volume-increment resolution (PR #4) | `volume_up_action` / `volume_down_action` | Per-action `adjustVolumeIncrement=2` overrides `globalAdjustVolumeIncrement=10`. Per-action `null`/`undefined` falls back to global. Per-action `1` (truthy edge) is **not** silently replaced (regression for the `??` vs `\|\|` fix). New volume clamps to `[0, 100]`. |
| `SonosSpeakers` rate limiter | `src/modules/plugin/SonosSpeakers.js:129-167` | After 3 `UPDATING` transitions inside 10 s, fourth call flips to `RATE_LIMITED`. After window decays, transitions resume. `UPDATED` resets `updateAttempts`. Context add/move/remove updates the `contexts: string[]` array atomically. |
| Marquee/title state machine | `updateStreamDeckStateAndTitle` (`actions/sonosController.js:135-411`) | Given a fixed `playing.title` longer than `marqueeWidth`, the top/bottom positions advance one char per call until wrapping. Album-art URI change resets marquee position. |
| Custom timer worker | `src/modules/common/timers.js` | `setTimeout` and `setInterval` shims fire in JSDOM with a polyfilled `Worker`; `clearTimeout` cancels a pending fire. (Use `vi.useFakeTimers` substitute.) |

### 13.3 Integration tests (`tests/integration/`)

Wire two or more units together against captured fixtures. Still no real network, no real Stream Deck.

- **Fixture corpus.** Capture once from a real household: `GetZoneGroupState` (single-zone, two-zone, two-group, with-satellite), `GetVolume`/`Mute`/`Bass`/`Treble`, `GetTransportInfo` (PLAYING / PAUSED / STOPPED / TRANSITIONING), `GetPositionInfo` (with and without album art), `Browse FV:2` (empty, 1 favorite, 50 favorites), `Browse Q:0` (empty, populated). Store as XML files under `tests/fixtures/sonos/`. Treat the corpus as canonical — do not hand-edit.
- **Mock SOAP server.** A `tests/helpers/mockSonosServer.js` that serves these fixtures on `http://127.0.0.1:1400` with the right `SOAPAction` routing. Use Node's `http.createServer`, no external deps.
- **Targets:**
  - `SonosController.getDevices({setAsPrimary: true})` end-to-end against each topology fixture; assert the resulting device list shape, primary flag, satellite detection, and that single-zone households produce one device (PR #3 regression).
  - `SonosController.getFavorites()` against each favorite fixture; assert title/uri/metadata/albumArtURI extraction.
  - `SonosSpeakers.getSpeaker({UUID})` driving a full `Promise.all` of the 7 polled SOAP calls against the mock server; assert the resulting `state` matches a snapshot.
  - `setServiceURI` for both the queue path (`AddURIToQueue` → `SetAVTransportURI x-rincon-queue:<coord>#0` → `Seek TRACK_NR 1`) and the radio-stream short-circuit (`x-sonosapi-stream:` → direct `SetAVTransportURI`); assert the SOAP call sequence captured by the mock server.
  - `play_sonos_favorite_action` orchestration (`actions/sonosController.js:1468-1540`): assert `RemoveAllTracksFromQueue` precedes the queue setup and `Play` is the final call.
  - PR #4 volume increment threading: drive `PluginComponent.callAction` with a synthesized `keyDown` for a Volume Up context, with both per-button override absent and present; assert the `SetVolume(DesiredVolume=N)` request body the mock server received.

### 13.4 Functional tests (`tests/functional/`)

Exercise the **Property Inspector** as a black-box SPA in a real browser. The plugin process is mocked at the WebSocket boundary.

- **Harness.** `pi.html` loads under Playwright. A `tests/helpers/streamDeckMock.js` opens a WebSocket on the port the PI's `connectElgatoStreamDeckSocket` hook expects, replays the `registerPropertyInspector` handshake, then scripts `didReceiveSettings` / `didReceiveGlobalSettings` payloads and asserts what the PI sends back via `setSettings` / `setGlobalSettings` / `sendToPlugin`.
- **Scenarios:**
  - **First-run discovery.** Empty global settings → only the "Global Settings" accordion is visible and auto-expanded; speakers list is hidden. Filling "Primary Device Address" and clicking "Save and Connect" emits a `sendToPlugin{event:"saveGlobalSettings", payload:{...}}` envelope. (Use a mocked `SonosController` so no real network.)
  - **Reconnect.** Pre-seeded global settings → button reads "Save and Reconnect", accordion is collapsed, speakers list populated. Clicking "Save and Reconnect" re-fires `getDevices`/`getFavorites`.
  - **Speaker selection persistence.** Selecting a speaker in the dropdown writes `setSettings` with the right `uuid`, `hostAddress`, `zoneName`, and `title` (`<zone> (<host>)`).
  - **Per-action accordion conditional rendering.** For each action UUID, assert which sections appear (Play Modes for `toggle-play-mode`, Input Sources for `toggle-input-source`, Equalizer Target for `encoder-audio-equalizer`, Sonos Favorites dropdown for `play-sonos-favorite`, Volume Increment override for `volume-up`/`volume-down`, etc.). Use the manifest as the source of truth — drive the test by iterating every action UUID.
  - **PR #4 — Global "Volume Increment (Up/Down)" field.** Default value `10`. Setting `0` is clamped to `1` before persisting. Setting `15` and saving emits `setGlobalSettings` with `adjustVolumeIncrement: 15`. Field appears inside the Global Settings accordion below `deviceCheckInterval`.
  - **PR #4 — Per-button Volume Increment override.** Visible only when `actionName ∈ {volume-up, volume-down}`. Placeholder reads `"Global default: <N>"` reflecting current global value. Leaving empty persists `null`; entering `1` persists `1` (regression for `??` semantics); entering `5` persists `5`.
  - **Error rendering.** PI receives a `sendToPropertyInspector{event:"sonosError", message:"Failed to get devices: Timeout while getting devices after 10 seconds"}` → red dismissible alert appears in the Global Settings accordion; clicking dismiss removes it.
  - **Equalizer target switching.** Changing the target dropdown to BASS emits `setSettings` and triggers a `sendToPlugin` event so the plugin can call `setFeedbackLayout` to swap from `encoder-bar-0-100.json` to `encoder-gbar-10-10.json`.

### 13.5 End-to-end tests (`tests/e2e/`)

Whole-system: plugin process + PI process + a fake Stream Deck app + a fake Sonos household. No real hardware required.

- **Fake Stream Deck app.** A Node script that stands up the WebSocket server the Stream Deck app would expose, then launches the plugin's `plugin.html` and `pi.html` under Playwright as separate browser contexts. Replays the real Stream Deck handshake (`registerPlugin`, `registerPropertyInspector`) and forwards events between them — this is the same protocol used by Elgato's own `streamdeck-mock` harness if the project chooses to depend on it instead.
- **Fake Sonos household.** The mock SOAP server from §13.3, started on `127.0.0.1:1400`, optionally wrapped with `tcpkali` or a latency proxy to simulate slow networks.
- **Scenarios (each is a "user story" walkthrough):**
  - **Story: install → discover → place a key → press it.** Boot plugin, send `willAppear` for a Toggle Mute/Unmute action with a placeholder context, open PI, complete first-run discovery, select a speaker, close PI, send `keyDown` → assert `SetMute` SOAP request hit the fake Sonos and the plugin emitted `setState` with the unmuted index.
  - **Story: poll loop reflects external state.** With a key bound to a speaker, mutate the fake Sonos's reported volume from 30 to 60 between polls; assert that within `2 × deviceCheckInterval` (≤ 20 s by default) the plugin issues a `setFeedback` with the new value (encoder) or `setTitle` (keypad with state-based title enabled).
  - **Story: speaker offline.** Take the fake Sonos offline; assert plugin transitions the speaker to `DISCONNECTED`, calls `showAlert` on `keyDown`, and recovers when the fake Sonos comes back.
  - **Story: rate limit.** Fire `keyDown` 5× in 2 s on a Volume Up key; assert at most 3 `SetVolume` requests reach the fake Sonos within the 10 s window and the speaker enters `RATE_LIMITED`, then resumes.
  - **Story: PR #4 increment resolution end-to-end.** Set global increment to 5, place two Volume Up keys, override one to 1 — three `keyDown` events on the overridden key produce volumes `+1, +1, +1`; three on the non-overridden key produce `+5, +5, +5`. The override-set-to-1 case proves the `??` fix in production.
  - **Story: PR #3 single-zone household.** Configure the fake Sonos to advertise a single ZoneGroup. First-run discovery completes without `groups is not iterable`. The single device appears in the PI dropdown and can be bound to a key.
  - **Story: SD+ encoder layout swap.** With an Equalizer encoder, change Equalizer Target from VOLUME to BASS via PI; assert the plugin issues `setFeedbackLayout("encoder-gbar-10-10.json")` and subsequent dial rotations call `SetBass(DesiredBass=N)` clamped to `[-10, 10]`.
  - **Story: timer worker survives backgrounding.** Patch the test harness to throttle JS timers to simulate webview backgrounding; assert the worker-backed `setInterval` in `timers.js` continues to drive the poll loop on schedule (within ±200 ms).

### 13.6 CI integration

Add to `.github/workflows/`:
- `npm test` (Vitest, unit + integration) → required check on all PRs. Target: < 30 s.
- `npm run test:functional` (Playwright against `pi.html` only) → required check; Playwright browsers cached.
- `npm run test:e2e` (Playwright + plugin harness) → required check on `main` only (slower, ~3 min). Allow opt-in on PRs via a `run-e2e` label.
- `coverage` step using Vitest's c8 reporter; gate at 70 % line coverage on `src/modules/` (excluding the dead `utils.js` and the worker shim).

### 13.7 Things explicitly out of scope for this test plan

- Real-hardware Stream Deck device tests. The Elgato SDK doesn't expose a deterministic device-side assertion API; on-device verification stays manual.
- Real Sonos S1 households. Targeting S2; S1 compatibility is best-effort and not in CI.
- Visual regression on key bitmaps. Generated icons are committed; their pixel output is verified by the existing `validate` step against the manifest, not by image diff.

---

## 14. Known Limitations & Implementation Gotchas

- **Hand-rolled SD WebSocket client.** Skips the SDK's reconnect, action-class abstraction, and TypeScript typings. Adding new lifecycle events requires manually editing the switch in `streamdeck.js:23-81`.
- **No real discovery.** Single user-provided IP → `ZoneGroupTopology`. No SSDP, no mDNS, no fallback IP scanning. If the primary device drops, the topology cache held in `globalSettings.devices` becomes stale. Single-zone households *are* now supported correctly (PR #3), but multi-group households still hit the "first ZoneGroup wins" assumption documented in the next bullet.
- **Single-coordinator assumption.** `setLocalTransport` always picks the **first** `ZoneGroup` in the topology XML (`sonosController.js:281`). In multi-group households this targets the wrong coordinator.
- **Polling, not events.** Every speaker is polled every 10 s with a 7-call `Promise.all`. With N speakers and M attached actions you get ~`7 * N` SOAP requests every 10 seconds. UPnP NOTIFY subscriptions would be much cheaper but are not implemented.
- **Rate limiting is a soft local guard, not a Sonos protection.** It only suppresses local re-fires, not rapid user input.
- **Vestigial dependencies.** `axios`, `sonos`, `js-yaml`, `nunjucks`, `snapsvg-cjs`, `fs` (the npm placeholder), `core-js`, `@mdi/font`, `@mdi/js` are all installed but not imported by the production bundle. They inflate `node_modules` and can be removed.
- **`npm run discovery` is broken.** `package.json:7` references `src/discovery.js` which does not exist.
- **Volume increment is now configurable (PR #4 — resolved).** Manifest tooltips no longer claim a numeric value; per-button override + global default are exposed in the PI. Use `??` (not `||`) when reading `inActionSettings.adjustVolumeIncrement` so a value of `1` is not falsy-coerced.
- **`sendToPlugin` envelope bug.** `streamdeck.js:208` sets `action: this.propertyInspectorUUID` but `propertyInspectorUUID` is the context UUID, not an action UUID. Currently dormant because the method is never called.
- **No persistence migration.** A change to the per-action settings shape will silently break existing button configurations.
- **Cached `zoneGroupState` per `SonosController` instance.** `getZoneGroupState` memoizes on the instance (`sonosController.js:259-269`). Because every action constructs a fresh `SonosController`, the cache is effectively per-call. In `PiComponent.saveGlobalSettings` two SOAP-heavy operations (`getDevices`, `getFavorites`) reuse the same controller and benefit from the cache.
- **`utils.js` is dead code.** Entire file is commented out (`src/modules/common/utils.js:1-140`). Safe to delete.
- **Custom timer worker (`src/modules/common/timers.js`).** Replaces `window.setTimeout`/`setInterval` with a Web Worker–backed implementation that posts messages to a Blob worker. Loaded explicitly via `<script type="module" src="src/modules/common/timers.js">` in `plugin.html:11`. Purpose: avoid throttling when the Stream Deck webview is backgrounded. Important to know if you ever step through timer-related code — `setTimeout` is **not** the platform implementation in plugin context.
- **CI uses ancient action versions.** `actions/checkout@v2`, `actions/setup-node@v2.1.4`, `actions/upload-release-asset@v1` are all deprecated. `releases.yml` uses the legacy upload-release-asset action that GitHub recommends migrating away from.
- **Branch CI workflow path filter typo.** `brainch.yml:9` watches `public.html` instead of `plugin.html`. Branch CI will not re-run when `plugin.html` changes.
- **Album art `setImage` for the `currently-playing` action sometimes references `playing.albumArt`** (`actions/sonosController.js:1679`) but the data model exposes `playing.albumArtURI`. Likely a bug that leaves album art blank for non-TV / non-Line-In sources.

---

## 15. How to Run Locally

### Prerequisites

- Node.js 20 (matches `manifest.json` `Nodejs.Version`).
- The Stream Deck app v6.5+ installed (Mac 10.11+ / Windows 10+).
- ImageMagick installed (only if you intend to regenerate icons via `generateImages.sh`).
- A Sonos speaker on the local LAN with port 1400 reachable from the host running Stream Deck.

### Install

```bash
git clone --recursive https://github.com/r-teller/streamdeck-sonoscontroller.git
cd streamdeck-sonoscontroller
npm install
```

If you forgot `--recursive`: `git submodule update --init --recursive` to pull `material-design-icons` (only required for icon regeneration).

### Build & side-load

```bash
npm run build_dev_incr   # auto-bumps Version, builds with sourcemaps, no minify
npm run validate         # run @elgato/cli sanity checks
npm run package          # produces com.r-teller.sonoscontroller.streamDeckPlugin
```

Double-click the resulting `.streamDeckPlugin` file — the Stream Deck app will install it. For active development you can also point the Stream Deck app at the build output directory by symlinking:

- macOS: `ln -s "$(pwd)/com.r-teller.sonoscontroller.sdPlugin" ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/`
- Windows: junction `%appdata%\Elgato\StreamDeck\Plugins\com.r-teller.sonoscontroller.sdPlugin` → repo build output.

After that, re-running `npm run build_dev_incr` and **restarting the plugin** from the Stream Deck app (right-click → "Reload") picks up changes. The version bump is what convinces Stream Deck to re-load the manifest.

### First-run configuration

Open the property inspector for any Sonos action → "Global Settings" accordion → enter the IP of any Sonos device (any single one is sufficient — the plugin uses it as the discovery seed) → "Save and Connect". The plugin issues `GetZoneGroupState` and `Browse(FV:2)` to populate device list and favorites.

### Development loop

There is no hot-reload story for the plugin webview; `vite dev` is mostly useless because Stream Deck doesn't speak to a dev server. The pragmatic loop is:

1. Edit code.
2. `npm run build_dev_incr`.
3. Right-click reload the plugin in Stream Deck.
4. Inspect via Stream Deck's plugin devtools (Cmd-click the action when in PI mode for inspector; for the background page enable `Nodejs.Debug` and attach Chrome devtools to `chrome://inspect`).
