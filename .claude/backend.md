# Plugin Background & Sonos Integration Reference

Purpose: Detailed reference for the plugin-side (non-PI) code — the Stream Deck WebSocket client, the action dispatcher, the polling supervisor, the Sonos SOAP layer, and the speaker state store. Read `architecture.md` first for the high-level overview. The PI is documented in `frontend.md`.

> "Backend" in this project does not mean an HTTP server. There is no API server. "Backend" here refers to the plugin background process — the headless Vue app that runs inside the Stream Deck application's Node.js host (`plugin.html`) and talks SOAP/HTTP directly to Sonos speakers on the LAN.

---

## Two surfaces, two WebSocket connections

The Stream Deck application opens **two** WebSocket connections to the plugin:

| Surface | Entry HTML | Purpose | Lifetime |
|---|---|---|---|
| Plugin background | `plugin.html` | All Sonos calls, polling, render dedupe, action dispatch | Lives as long as the plugin is loaded |
| Property Inspector | `pi.html` | Settings UI shown when the user selects a placed action | Open only while the user is editing a button |

The two never talk to each other directly. They share state exclusively through Stream Deck's `setSettings` / `setGlobalSettings` (per-action and plugin-wide JSON blobs persisted by the host). This file covers the plugin-background surface; the PI surface is covered in `frontend.md`.

---

## Stream Deck SDK Integration

### Hand-rolled WebSocket client (`src/modules/common/streamdeck.js`)

The official `@elgato/streamdeck` SDK is **not** used as a runtime client. Only its `EventEmitter` is imported. The Stream Deck app calls `window.connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo)` once `plugin.html` (or `pi.html`) loads. That hook constructs a `StreamDeck` instance which:

1. Opens `new WebSocket("ws://localhost:" + inPort)`.
2. On `onopen`, sends `{event: inRegisterEvent, uuid: inPropertyInspectorUUID}` — the registration handshake.
3. Registers a single `onmessage` handler that switches on `incomingEvent.event` and re-emits each Stream Deck event under the same name through its `EventEmitter`.

Events handled and re-emitted:
`didReceiveGlobalSettings` (re-emitted as `globalsettings`), `deviceDidConnect`, `deviceDidDisconnect`, `keyDown`, `keyUp`, `dialDown`, `dialUp`, `dialRotate`, `touchTap`, `systemDidWakeUp`, `willAppear`, `willDisappear`, `didReceiveSettings`, `sendToPlugin`, `sendToPropertyInspector`, `propertyInspectorDidAppear`, `propertyInspectorDidDisappear`, `titleParametersDidChange`. Anything else logs `Unhandled Event: <name>`.

### Outgoing message helpers

| Method | Stream Deck event | Notes |
|---|---|---|
| `requestGlobalSettings()` | `getGlobalSettings` | |
| `saveGlobalSettings({payload})` | `setGlobalSettings` | PI-only in practice |
| `getSettings({context})` | `getSettings` | |
| `saveSettings({actionSettings, context})` | `setSettings` | PI-only |
| `setTitle({context, title})` | `setTitle` | target=0, both states |
| `logMessage({messageText})` | `logMessage` | |
| `setImage({context, image, state})` | `setImage` | data URLs supported |
| `setFeedback({context, payload})` | `setFeedback` | SD+ encoder LCD |
| `setFeedbackLayout({context, payload})` | `setFeedbackLayout` | SD+ encoder LCD |
| `showAlert({context})` | `showAlert` | error glyph |
| `showOk({context})` | `showOk` | |
| `setState({context, stateIndex})` | `setState` | |
| `sendToPlugin({context, payload})` | `sendToPlugin` | currently buggy: sets `action: this.propertyInspectorUUID` (which is actually a context UUID) — never called in production code |
| `sendToPropertyInspector({context, payload})` | `sendToPropertyInspector` | |

### Surface boundaries

- The plugin background **never** sends `setSettings` or `setGlobalSettings`. Only the PI does.
- The plugin background **only** updates UI via `setState`, `setImage`, `setTitle`, `setFeedback`, `setFeedbackLayout`, `showAlert`.
- The PI ↔ plugin contract is "PI writes settings, plugin reacts to `didReceiveSettings` / `didReceiveGlobalSettings`." No `sendToPlugin` is used for state synchronization.

---

## Action Dispatcher (`PluginComponent.vue`)

`PluginComponent.vue` is the entire plugin-side runtime. It mounts as a Vue component but renders only debug text — its real purpose is to wire up SDK handlers in `onMounted`.

### Registry: `actionFunctionMap`

Keyed by the **last segment** of the action UUID (e.g., `"toggle-mute-unmute"`). Each entry has:

```js
{
  keyDown:   [actionFn1, actionFn2, ...],      // Keypad action handlers
  dialRotate: [...], dialDown: [...],          // Encoder handlers (Audio Equalizer only)
  state: { default: stateFn, keypad: …, encoder: … },  // Render handlers
}
```

`callAction({inContext, inEvent, inRotation})`:
1. Extracts the action short name from `actionSettings[inContext].action.split(".").pop()`.
2. Looks up the matching `actionFunctionMap` entry.
3. Fetches the speaker for the context.
4. Sets `OPERATIONAL_STATUS.UPDATING`.
5. Awaits the action function.
6. On success: `sonosSpeakers.updateSpeakerState({UUID, state: result.updatedSonosSpeakerState})` (optimistic projection).
7. On failure: emits `showAlert` to **every** context attached to that speaker and sets `OPERATIONAL_STATUS.DISCONNECTED`.

### Lifecycle hooks consumed

| SDK event | Handler responsibility |
|---|---|
| `willAppear` | Initialize `actionSettings[context]` with `{...payload.settings, currentStateIndex: payload.state || 0}`; register the context with the appropriate speaker |
| `willDisappear` | Delete the context's settings; remove from speaker; if last context, remove the speaker entirely |
| `didReceiveSettings` | Re-cache settings; if PI changed the bound speaker UUID, `moveContext` from old → new |
| `keyDown`, `dialDown`, `touchTap` | Call `callAction` directly |
| `dialRotate` | Accumulate `payload.ticks` per context into `rotationAmount[context]` and **debounce 300 ms** before dispatching — coalesces rapid spins into one SOAP call |
| `keyUp`, `dialUp` | Explicitly **not** handled (no long-press semantics) |
| `globalsettings` | Cache `globalSettings.value`; update poll/timeout values |
| `systemDidWakeUp` | Survive without losing speaker state — polling resumes naturally |

### Polling supervisor

A `setInterval(..., 500ms)` walks every speaker UUID and fires when:
- `secondsLastChecked >= deviceCheckInterval` (default 10 s, configurable via global settings)
- The speaker is not currently `UPDATING` or `RATE_LIMITED`

Each fetch:
1. Constructs a fresh `SonosController` for that host.
2. Races `getDeviceInfo()` (which itself fans out 7 SOAP calls in `Promise.all`) against a `deviceTimeoutDuration * 1000` ms timeout (default 10 s for actions, 5 s for polling).
3. Stores result via `sonosSpeakers.updateSpeakerState(..., updateLastChecked: true)`.
4. On exception, every context attached to that speaker gets `showAlert` and the speaker flips to `DISCONNECTED`.

After the speaker fetch, if `operationalStatus === UPDATED`, the loop fans out to `refreshStateAndTitle({inContext, inSonosSpeakerState})` for every attached context.

### Render dedupe (no flashing)

`refreshStateAndTitle` selects the controller-specific state handler (`controller.toLowerCase()` matches `keypad` or `encoder`, falling back to `default`), invokes it, and only calls `setState` / `setImage` / `setTitle` / `setFeedback` when the new value differs from the last value pushed for that field.

Per-context the plugin remembers `lastTitleValue`, `lastCustomTitle`, `lastPlayingTitle`, `albumArtURILastValue`, `lastAudioEqualizer{Bass,Treble,Volume}`, `lastAudioEqualizerLayout`, etc. (held under `actionSettings[context].status`). Marquee animations are an explicit exception: when a marquee is active, title updates are *expected* every frame and dedupe is scoped to the underlying source string, not the per-frame substring.

**Acceptance:** with a key bound to a stable Sonos state (paused, fixed track, no marquee), no visible redraw must occur across at least 60 seconds of polling.

### Action implementation pattern

Every action handler follows this template:

```js
const sonosController = new SonosController();
sonosController.connect(inActionSettings.hostAddress);
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("Timeout toggling mute")), deviceTimeoutDuration * 1000));
const result = await Promise.race([sonosController.setMute(newMuteState), timeout]);
return { status: "SUCCESS", updatedSonosSpeakerState: { ...prevState, muted: newMuteState } };
```

Returns `{status: "SUCCESS", updatedSonosSpeakerState}` on success — a *projected* state (local merge of previous state + changed field) so the next 500 ms tick re-renders immediately without waiting for the next poll. Returns `{status: "ERROR"}` on failure.

---

## Action catalog

All eleven actions live under category "Sonos Controller" in the Stream Deck app sidebar. UUIDs use the namespace `com.r-teller.sonoscontroller.<short-name>` and **must match these strings verbatim** so that previously placed buttons survive a clean rebuild.

| Action UUID short-name | Display name | Controller | Behavior |
|---|---|---|---|
| `currently-playing` | Currently Playing | Keypad | Read-only now-playing tile; press forces an immediate refresh outside the polling cadence |
| `toggle-mute-unmute` | Toggle Mute | Keypad | Read mute → `RenderingControl#SetMute(!current)` → optimistic state |
| `toggle-play-pause` | Toggle Play/Pause | Keypad | If `PLAYING` send `Pause`, else send `Play`; STOPPED→Play |
| `toggle-play-mode` | Toggle Play Mode | Keypad | Cycle through user-selected subset (6 checkboxes); fall back to first selected if current is unchecked |
| `toggle-input-source` | Toggle Input Source | Keypad | Cycle Sonos Queue / TV Input / Line-In; build next URI as `<prefix>:<COORDINATOR_UUID><suffix>` and submit `SetAVTransportURI` then `Play` |
| `play-next-track` | Play Next Track | Keypad | `AVTransport#Next` |
| `play-previous-track` | Play Previous Track | Keypad | `AVTransport#Previous` |
| `volume-up` | Volume Up | Keypad | `min(100, current + increment)`. Increment resolution: per-button override (`adjustVolumeIncrement`) → global `Volume Increment (Up/Down)` (default 10, min 1). Use `??` not `\|\|` so a value of `1` is not falsy-coerced |
| `volume-down` | Volume Down | Keypad | `max(0, current - increment)`; same increment resolution as Volume Up |
| `play-sonos-favorite` | Play Sonos Favorite | Keypad | `RemoveAllTracksFromQueue` → `setServiceURI` (`AddURIToQueue` + `SetAVTransportURI x-rincon-queue:<coord>#0` + `Seek TRACK_NR 1`) → `Play`. Radio-stream favorites (`x-sonosapi-stream:` prefix) skip the queue step. **Only action with `UserTitleEnabled: true` and `DisableCaching: false`**. |
| `encoder-audio-equalizer` | Audio Equalizer | Encoder (SD+) | Rotate ±1 per tick, batched 300 ms. Volume clamps `[0,100]`; Bass/Treble clamps `[-10,+10]`. `setFeedbackLayout` swaps between `encoder-bar-0-100.json` and `encoder-gbar-10-10.json` based on target. Touch tap = refresh state. Dial press = no-op |

Manifest invariants for every action (except `play-sonos-favorite`):
- `UserTitleEnabled: false` (plugin renders titles itself)
- `DisableAutomaticStates: true` (state index set explicitly)
- `DisableCaching: true` (plugin overwrites images at runtime)

---

## Sonos Integration Layer (`src/modules/common/sonosController.js`)

### Discovery

Bootstrapped from a single user-provided IPv4 (the "Primary Device"). The PI uses that address to fetch `GetZoneGroupState` from the `ZoneGroupTopology` service and walks the resulting XML to extract every member (and satellite). That becomes the static device list stored in global settings.

**No SSDP, mDNS, or topology multicast.** No Sonos OAuth.

#### XML→JSON shape normalization (critical)

`convertXmlToJson` returns a *plain object* for a single child element and *promotes to array* only when duplicate sibling keys exist. A household with exactly one zone group therefore returns `ZoneGroups.ZoneGroup` as **an object, not an array**, and a naive `for...of` throws `groups is not iterable`.

**Every iteration over `ZoneGroup`, `ZoneGroupMember`, and `Satellite` must defensively wrap with `[].concat(value || [])`** to coerce single-vs-many into a uniform iterable. A single forgotten iteration site surfaces to the user as `Failed to get devices: <name> is not iterable` and blocks all setup.

Acceptance: discovery must succeed against (a) a household consisting of exactly one Sonos Move or Roam, (b) a household with one stereo pair, (c) a household with a home theater group containing soundbar + sub + two surround satellites.

### SOAP transport (`SonosService` class)

Builds a UPnP envelope, POSTs to `http://${host}:1400/${baseUrl}/Control` with header:

```
SOAPAction: "urn:schemas-upnp-org:service:${name}:1#${action}"
```

Response is parsed with `DOMParser` and flattened `Body > * > *` into a `{nodeName: textContent}` dict.

### Service endpoints registered by `SonosController`

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
- 500 ms supervisor decides which speakers are due.
- A speaker is fetched when `secondsLastChecked >= deviceCheckInterval` (default 10 s).
- Each fetch concurrently issues 7 SOAP calls via `Promise.all`: `GetTransportSettings`, `GetTransportInfo`, `GetMute`, `GetVolume`, `GetBass`, `GetTreble`, `GetPositionInfo` (and optionally `GetQueue`).

### Per-action SOAP commands

| Action | SOAP call |
|---|---|
| Play / Pause | `AVTransport#Play(Speed=1)` / `Pause` |
| Next / Prev | `AVTransport#Next` / `Previous` |
| Mute toggle | `RenderingControl#SetMute(Channel=Master, DesiredMute=0\|1)` |
| Volume | `RenderingControl#SetVolume(Channel=Master, DesiredVolume=N)` |
| Bass / Treble | `RenderingControl#SetBass(DesiredBass=N)` / `SetTreble`. Range `[-10, 10]` |
| Play Mode | `AVTransport#SetPlayMode(NewPlayMode=NORMAL\|SHUFFLE\|...)` |
| Input Source | `AVTransport#SetAVTransportURI` via `setLocalTransport(prefix, suffix)` building e.g. `x-rincon-stream:RINCON_xxx` |
| Play Favorite | `RemoveAllTracksFromQueue` → `AddURIToQueue` → `SetAVTransportURI x-rincon-queue:<coord>#0` → `Seek(TRACK_NR=1)` → `Play`. For `x-sonosapi-stream:` favorites, skip the queue step and `SetAVTransportURI` directly |
| Browse Favorites | `ContentDirectory#Browse(ObjectID=FV:2, BrowseFlag=BrowseDirectChildren)` |
| Get Queue | `ContentDirectory#Browse(ObjectID=Q:0)` |

### URI taxonomy (input source detection)

| Prefix | Source |
|---|---|
| `x-sonos-htastream` (suffix `:spdif`) | TV Input |
| `x-rincon-stream` | Line-In |
| `x-rincon-queue` | Sonos Queue |
| `x-sonos-spotify:` | Spotify track |
| `x-sonos-http:` | Sonos Radio |
| `x-sonosapi-stream:` | Broadcast (handled specially in `setServiceURI`) |

`getInputSourceMappings(uri)` detects the current source from prefix/suffix and returns prefix/suffix factories so the toggle can construct the next URI.

### Group management

Out of scope. The PI never lets the user change group membership. Coordinator/group topology is parsed during `getDevices` only to resolve per-device `Location` URLs. Local-transport switching uses the coordinator UUID via `setLocalTransport`. The current implementation always picks the **first** `ZoneGroup` in the topology XML, which makes behavior in multi-group households undefined — the rebuild should resolve the coordinator for the *bound speaker's* group, not the first group.

---

## Speaker store (`src/modules/plugin/SonosSpeakers.js`)

Single source of truth for per-speaker state inside the plugin process. Vue `reactive({})` map keyed by speaker UUID. One instance, created at module scope, shared across all action handlers.

### Per-speaker record

| Field | Shape |
|---|---|
| `contexts` | `string[]` of every Stream Deck context bound to this speaker |
| `operationalStatus` | enum (see below) |
| `state` | `{audioEqualizer:{bass,treble,volume}, playMode, playbackState, currentURI, muted, playing?, queue?}` |
| `updateAttempts` | `number[]` epoch seconds — for rate limiting |
| `lastChecked`, `lastUpdated` | timestamps |

### `OPERATIONAL_STATUS` enum

`UNINITIALIZED → UPDATING → UPDATED → ...` or `→ DISCONNECTED` / `→ RATE_LIMITED`.

### Rate limiting

`getSpeaker({UUID})` tracks `updateAttempts: number[]`. If more than `maxUpdates = 3` `UPDATING` transitions happen inside `timeWindow = 10` seconds, the speaker is forcibly flipped to `RATE_LIMITED`. The 500 ms poll loop skips rate-limited speakers until the window decays. `UPDATED` resets the window.

This is a soft local guard against tight retry loops during a sustained outage — it does **not** protect Sonos itself from rapid user input (users can still mash a key and fire a SOAP call per press).

---

## Conventions

- **Use native `fetch`, not `axios`.** `axios` is in `package.json` but unused — prefer fetch for the rebuild.
- **Construct a fresh `SonosController` per action call.** State is not shared across calls; the cached `zoneGroupState` per instance only helps when the same instance batches multiple SOAP-heavy operations (e.g., the PI's `getDevices` + `getFavorites`).
- **Race every SOAP call against an explicit timeout.** Default action timeout 10 s; default polling timeout 5 s. Both are configurable via global settings.
- **Always defensively normalize XML→JSON arrays.** Wrap any iteration over `ZoneGroup`, `ZoneGroupMember`, `Satellite` with `[].concat(value || [])`.
- **Translate exceptions at the boundary.** User-visible errors must carry actionable messages (`"Timeout while getting devices after 10 seconds"`, `"Could not reach 192.168.1.42:1400"`) — never leak programmer artifacts like `"u is not iterable"` or `"Cannot read property 'x' of undefined"`.
- **Render dedupe is mandatory.** Never call `setState` / `setImage` / `setTitle` / `setFeedback` if the value hasn't changed (marquee animations excepted).
- **Use `??` not `\|\|`** when reading numeric overrides like `adjustVolumeIncrement` so a value of `1` is not falsy-coerced.
- **Use the Web Worker timer shim (`src/modules/common/timers.js`)** for `setTimeout` / `setInterval` in `plugin.html` — `<script type="module" src="src/modules/common/timers.js">` is already wired up. Avoids webview backgrounding throttling.

---

## Key Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| Stream Deck client | Hand-rolled WebSocket wrapper + outgoing helpers | `src/modules/common/streamdeck.js` |
| Sonos client | SOAP-over-HTTP service endpoints + XML→JSON + topology enumeration | `src/modules/common/sonosController.js` |
| Action handlers | All keyDown/dialRotate/state functions for the 11 actions | `src/modules/actions/sonosController.js` |
| Speaker store | Reactive per-UUID speaker state, rate limiting, context tracking | `src/modules/plugin/SonosSpeakers.js` |
| Timer shim | Web Worker–backed `setTimeout` / `setInterval` to defeat webview throttling | `src/modules/common/timers.js` |
| Plugin entry | Vue mount + SDK wiring + dispatcher + polling | `plugin.html`, `src/plugin/main.js`, `src/components/PluginComponent.vue` |
