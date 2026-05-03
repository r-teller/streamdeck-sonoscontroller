# Property Inspector (PI) Reference

Purpose: Detailed reference for the user-facing settings panel — `pi.html` and its Vue components. Read `architecture.md` first for the high-level overview. Plugin background internals are in `backend.md`.

> The PI is the only interactive UI surface this plugin has. It opens to the right of the Stream Deck app whenever the user selects a placed action. It is implemented as a normal Vue 3 SPA and runs inside an embedded Chromium webview.

---

## Pages

There is exactly one HTML entry, reused for every action. The PI dynamically renders the appropriate controls based on the current action's UUID.

| Route | Page | Purpose |
|-------|------|---------|
| `pi.html` | `PiComponent.vue` | Single panel, dark-themed, that adapts its visible content to the current action UUID |
| `plugin.html` | `PluginComponent.vue` | Headless background — renders only the literal text "Nothing to see here" for visual debugging |

The PI runs Bootstrap 5 in **dark theme** (`pi.html` includes `data-bs-theme="dark"`). `pi.html` mounts `src/pi/main.js`, which:

```js
import { createApp } from "vue";
import PiComponent from "@/components/PiComponent.vue";
import "../scss/styles.scss";       // imports bootstrap/scss/bootstrap
import * as bootstrap from "bootstrap";   // for collapse/dropdown JS
createApp(PiComponent).mount("#app");
```

---

## Component Tree

- **`PiComponent.vue`** — the entire screen. Owns global state (current action UUID, current settings, current global settings, connection state) and dispatches `saveSettings` / `saveGlobalSettings`.
  - **`AccordeonComponent`** (`BootstrapAccordeon.vue`) wrapping an `AccordeonItem` titled **"Available Sonos Speakers"**, containing:
    - **`<SonosSelection>`** (`SonosSelection.vue`) — `v-model` two-way binds to `sonosSpeaker` (UUID string). Renders a `<select size="5">` with text-filterable options. Emits `selection-saved` to trigger `saveSettings`.
  - Inline form-switch checkboxes (Bootstrap `form-check form-switch`) for `displayStateBasedTitle`, `displayMarqueeTitle`, `displayMarqueeAlbumTitle`, `displayAlbumArt`. Visibility is gated by per-action allow lists.
  - Conditional sections rendered based on action UUID:
    - **`Play Mode(s)`** — six switches (Toggle Play Mode only)
    - **`Input Source(s)`** — three switches (Toggle Input Source only)
    - **`Equalizer Target`** — `<select>` (Audio Equalizer encoder only)
    - **`Sonos Favorite(s)`** — `<select>` (Play Sonos Favorite only)
  - Selected-speaker alert box that always shows the bound speaker's title (e.g., `Office (192.168.1.42)`) — visible even when the picker accordion is collapsed.
  - **Global Settings** accordion (auto-expanded when not yet connected, collapsed once connected) with four labeled inputs and a "Save and Connect" / "Save and Reconnect" button.

### `BootstrapAccordeonItem.vue`

Wraps Bootstrap 5's accordion markup. Composes the collapse target id as `'collapse' + itemId` and the parent as `'#' + accordeonId`. The `forceExpanded` prop drives the `show`/`collapse` and `aria-expanded` attributes (used to auto-open Global Settings on first run).

---

## PI Layout — top to bottom

### 1. "Sonos Speakers" group (top)

- Heading: **"Sonos Speakers"**.
- Inside an accordion section labeled **"Available Sonos Speakers"** (collapsible). Collapsed by default once a connection has been established.
  - Grey hint line, always visible above the picker: `Note: Devices marked with 🛰️ are satellites`.
  - Multi-line `<select size=5>` listing all discovered speakers. Each option label: `<ZoneName> (<HostAddress>) [🛰️ if satellite]`. List sorted **case-insensitively** by label.
  - Free-text filter input below the list: `Filter by name or Sonos Speaker ID...`. Filter matches label or UUID, case-insensitive.
- **Selected-speaker alert box** below the accordion — always shows the currently selected speaker title. Makes the binding visible even when the picker accordion is collapsed.

### 2. Per-action presentation toggles

The following four switches each render only when the current action is in that toggle's allow-list. **All four default to off.** Toggling any of them auto-saves the action's settings.

| Toggle | Visible for these actions |
|---|---|
| Display State Based Title | Toggle Play Mode, Toggle Input Source, Toggle Play/Pause, Toggle Mute, Volume Up, Volume Down, Play Previous Track, Play Next Track |
| Display Marquee Title | Play Sonos Favorite, Currently Playing |
| Display Marquee Album Title | Toggle Play/Pause, Currently Playing |
| Display Album Art | Toggle Play/Pause, Play Sonos Favorite, Currently Playing |

### 3. Action-specific configuration sections

Rendered conditionally based on action UUID (titled `h1`):

- **`Play Mode(s)`** (Toggle Play Mode only): six switches — Normal, Shuffle No Repeat, Shuffle Repeat One, Shuffle, Repeat One, Repeat All. **All checked by default.** Auto-save on change. Label format: state name with underscores replaced by spaces and each word title-cased.
- **`Input Source(s)`** (Toggle Input Source only): three switches — Sonos Queue, Tv Input, Line In. **All checked by default.** Auto-save.
- **`Equalizer Target`** (Audio Equalizer only): single dropdown — Volume, Bass, Treble. **Default Volume.** Auto-save.
- **`Sonos Favorite(s)`** (Play Sonos Favorite only): single dropdown listing every Sonos favorite from global settings, by title. **Default first favorite.** Auto-save.
- **Volume Increment override** (Volume Up / Volume Down only): optional numeric input, **min 1**, helper text "Volume range: 0–100", placeholder shows current global default (e.g., "Global default: 10"). Empty → inherit global.

### 4. "Global Settings" group (bottom)

- Heading: **"Global Settings"**.
- Accordion containing one section "Global Settings" — auto-expanded when not yet connected, collapsed once connected.
- Four labeled inputs (each label has small grey explanatory hint):

| Label | Type | Default | Validation | Hint |
|---|---|---|---|---|
| **Primary Device Address (Discovery)** | text (IPv4 or hostname) | empty | non-empty before "Save and Connect" can be tapped | "Note: This device is used to discover all other devices on the network" |
| **Device Timeout Duration (Actions)** | seconds | 10 | positive integer | "Note: This timeout is used when executing device actions (in seconds)" |
| **Device Check Interval (Actions)** | seconds | 10 | positive integer | "Note: This interval is used to check the status of the device selected for this action (in seconds)" |
| **Volume Increment (Up/Down)** | number | 10 | min 1; values < 1 silently clamped to 1 on save | "Note: Volume range is 0–100. Used by Volume Up and Volume Down actions unless overridden per-button." |

- **"Save and Connect"** / **"Save and Reconnect"** button (right-aligned, primary color). Disabled when:
  - Primary Device Address is empty.
  - A connection attempt is currently in flight (button shows a small spinner and remains disabled until done).
- If a connection error has been raised, an inline **red dismissible alert** above the form shows the error message.

### 5. Empty / disconnected state

When no global discovery has succeeded yet, the speakers list and per-action sections are **hidden** — only the Global Settings accordion is visible (auto-expanded), with the discovery field empty and the "Save and Connect" button visible.

### 6. Selected-speaker default

When a brand-new action is dropped onto a key, its bound speaker defaults to the **discovery (primary) speaker**. The user can re-bind it to any other discovered speaker via the picker.

---

## Discovery Flow

Trigger flow on **"Save and Connect"** click:

1. PI validates Primary Device Address is non-empty.
2. `new SonosController().connect(primaryDeviceAddress.value)`.
3. Race `getDevices({setAsPrimary: true})` (which calls `GetZoneGroupState` and walks every `ZoneGroupMember` and `Satellite`) against `deviceTimeoutDuration` timeout. Marks the discovery device as `primary`.
4. Race `getFavorites()` (calls `Browse FV:2`) against the same timeout — populates the `Sonos Favorites` selector.
5. `streamDeckConnection.saveGlobalSettings({payload: {devices, deviceCheckInterval, deviceTimeoutDuration, adjustVolumeIncrement, favorites}})`.
6. `refreshAvailableSonosSpeakers` constructs `SonosSpeaker` POJOs (`{zoneName, hostAddress, title, uuid}`, title formatted as `"<zoneName> (<host>) [🛰️]"`), sorts alphabetically by title, and assigns the model.
7. Button label flips to **"Save and Reconnect"**.

Both calls (`getDevices` + `getFavorites`) **share the same `SonosController` instance**, which memoizes `zoneGroupState` so the topology XML is fetched only once.

---

## Settings Persistence

### Per-action settings (`saveSettings`)

`PiComponent.saveSettings` writes a flat object to per-context settings via `streamDeckConnection.saveSettings`:

```ts
{
  action: string,                      // full UUID, e.g. "com.r-teller.sonoscontroller.toggle-mute-unmute"
  states: ManifestStates[],            // copy of manifest States so the plugin doesn't re-read manifest
  controller: "Keypad" | "Encoder",
  uuid: string,                        // bound Sonos speaker UUID (RINCON_xxx)
  title: string,                       // "<zone> (<host>)"
  hostAddress: string,                 // IPv4
  zoneName: string,
  selectedPlayModes: string[],         // toggle-play-mode only
  selectedInputSources: string[],      // toggle-input-source only
  encoderAudioEqualizerTarget: "VOLUME" | "BASS" | "TREBLE",
  displayStateBasedTitle: boolean | null,
  displayAlbumArt: boolean | null,
  displayMarqueeTitle: boolean | null,
  displayMarqueeAlbumTitle: boolean | null,
  selectedSonosFavorite: { title, uri, metadata, albumArtURI } | null,
  adjustVolumeIncrement: number | null,  // volume-up / volume-down only; null → inherit global
}
```

**Important details:**
- `metadata` is **base64-decoded back to UTF-8** before persisting (it is base64-encoded when held in dropdown options to avoid HTML attribute encoding issues).
- `adjustVolumeIncrement` round-trips as `null` when cleared. The action handler must read it with `??` (not `||`) so `1` is not falsy-coerced.

### Global settings (`saveGlobalSettings`)

```ts
{
  devices: { [uuid: string]: { primary, hostAddress, port, zoneName, isSatellite, idleState, uuid } },
  deviceCheckInterval: number,    // default 10 (sec)
  deviceTimeoutDuration: number,  // default 10 for actions, 5 for polling — PI label says "Actions"
  adjustVolumeIncrement: number,  // default 10, min 1; clamped at write via Math.max(1, value)
  favorites: { title, uri, metadata, albumArtURI }[],
}
```

`Math.max(1, value)` clamping happens before persisting because the HTML `min="1"` attribute is bypassable in the Electron webview's `v-model.number` binding.

### How the plugin sees it

The PI saves; the plugin background's `didReceiveSettings` / `didReceiveGlobalSettings` handlers re-cache the values. **Both surfaces communicate exclusively through `setSettings` / `setGlobalSettings`.** No `sendToPlugin` / `sendToPropertyInspector` is used for state synchronization.

---

## Component Patterns

- **Form pattern:** Bootstrap 5 controls (`form-check form-switch`, `<select>`, accordion). All toggles auto-save on change. The "Save and Connect" form is the one explicit submit (because it issues network calls).
- **State management:** Local Vue `ref` / `reactive` state. No store library. Settings round-trip through Stream Deck SDK calls.
- **Error handling:** Inline red dismissible alert in the Global Settings accordion. Error message comes from the underlying exception's `message` property — every user-visible exception must carry an actionable message (translate at the boundary).
- **Dialog pattern:** N/A — there are no dialogs in the PI. Everything is inline accordion + form controls.

---

## Conventions

- **The PI never silently fails.** Either the action succeeds (button label flips to "Save and Reconnect") or a red alert appears above the inputs.
- **Auto-save on change for all toggles, dropdowns, and per-action sub-settings.** Only Global Settings requires an explicit "Save and Connect" click (because it triggers network discovery).
- **Discovery error messages must be human-readable.** "Failed to get devices: Timeout while getting devices after 10 seconds" — not "u is not iterable".
- **Use `??` (not `\|\|`)** when reading numeric per-button overrides so a value of `1` is preserved.
- **Sort speaker dropdown case-insensitively** by the formatted title (`"<zone> (<host>)"`).
- **Mark satellites with 🛰️** in the dropdown label.

---

## Accessibility

- The PI uses standard form controls (HTML `<select>`, `<input>`, checkboxes, switches), inheriting the host webview's accessibility tree.
- **Color is not the only cue.** State-based title text and icon shape together communicate state so colorblind users can still tell muted vs. unmuted, etc.
- Action icons must remain readable at the smallest Stream Deck key resolution (72×72 px) — the icon set already accounts for this.

---

## Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `PiComponent` | Full PI screen — speaker selection, per-action sections, global settings, save/connect orchestration | `src/components/PiComponent.vue` |
| `PluginComponent` | Headless background — SD socket wiring, action dispatch, polling supervisor | `src/components/PluginComponent.vue` |
| `SonosSelection` | `<select size=5>` with text filter, v-model UUID, emits `selection-saved` | `src/components/SonosSelection.vue` |
| `BootstrapAccordeon` | Slot wrapper around `.accordion` | `src/components/accordeon/BootstrapAccordeon.vue` |
| `BootstrapAccordeonItem` | Header + collapse item; supports `forceExpanded` prop for first-run auto-open | `src/components/accordeon/BootstrapAccordeonItem.vue` |
