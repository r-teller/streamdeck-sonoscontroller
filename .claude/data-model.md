# Data Model Reference

Purpose: There is no database. "Data model" here means the in-memory store the plugin maintains for each Sonos speaker plus the JSON shapes the plugin persists via Stream Deck's `setSettings` / `setGlobalSettings`. Read `architecture.md` first for the high-level overview.

> Settings are the only persistence layer. The Stream Deck application stores them as opaque JSON blobs keyed by plugin UUID and per-action context. Live runtime state (current track, volume, etc.) is not persisted — it is rebuilt from polling on every plugin start.

---

## Storage layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│                Stream Deck application — settings store                   │
│                                                                           │
│  Global settings (one blob, plugin-scoped)                               │
│    { devices: {UUID: DeviceRecord},                                       │
│      deviceCheckInterval, deviceTimeoutDuration,                          │
│      adjustVolumeIncrement, favorites: [Favorite] }                       │
│                                                                           │
│  Per-context settings (one blob per placed action instance)              │
│    { action, states, controller, uuid, hostAddress, …,                    │
│      adjustVolumeIncrement (volume-up/down only), …, status }             │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ didReceiveSettings / didReceiveGlobalSettings
┌──────────────────────────────────────────────────────────────────────────┐
│              Plugin background runtime (in-memory only)                   │
│                                                                           │
│  globalSettings: ref({...})                ← from didReceiveGlobalSettings│
│  actionSettings: { [context]: {...} }      ← from didReceiveSettings      │
│  sonosSpeakers:  { [uuid]: SpeakerRecord } ← built by polling             │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ SOAP/HTTP port 1400
┌──────────────────────────────────────────────────────────────────────────┐
│                  Sonos LAN — source of truth for live state               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Entity Relationship Overview

```
        ┌──────────────┐         ┌──────────────┐
        │ Global       │         │ Per-context  │
        │ Settings     │         │ Settings     │
        │              │  uuid   │              │
        │ devices ─────┼────────▶│ uuid         │
        │ favorites ───┼────────▶│ selected     │
        │              │         │  SonosFavorite│
        └──────────────┘         └──────┬───────┘
                                        │ uuid
                                        ▼
                                ┌──────────────┐
                                │ Speaker      │
                                │ (in-memory)  │
                                │              │
                                │ contexts: [] │◀── many contexts may
                                │ state: {...} │    bind to one speaker
                                └──────────────┘
```

A single Sonos speaker (UUID) may be bound to many Stream Deck action contexts (e.g., one Mute key, one Volume Up key, one Volume Down key, all targeting the same speaker). The plugin stores a `contexts: string[]` array on the speaker record so a state refresh fans out to every relevant key/dial.

---

## Models (in-memory plugin store)

| Model | Location | Purpose | Key Relationships |
|---|---|---|---|
| `SpeakerRecord` | `SonosSpeakers` reactive map (`src/modules/plugin/SonosSpeakers.js`) | Live cache of one Sonos speaker's state and operational status | Holds `contexts: string[]` of bound action contexts |
| `SpeakerState` | nested in SpeakerRecord | Polled snapshot of audio/transport state | None (value object) |
| `PlayingInfo` | nested in SpeakerState | Current-track metadata | None |
| `Queue` / `QueueItem` | nested in SpeakerState | Browsed queue contents (optional, only when `getQueue=true`) | None |
| `DeviceRecord` | global settings `devices[uuid]` | Persisted topology entry from discovery | Foreign key by UUID into `SpeakerRecord` |
| `Favorite` | global settings `favorites[]` | Persisted favorite from `Browse FV:2` | Referenced by `selectedSonosFavorite` on per-action settings |
| `ActionSettings` | per-context settings (`setSettings`) | Per-button configuration | Foreign key `uuid` into `DeviceRecord` |
| `PI Speaker POJO` | `src/modules/pi/SonosSpeaker.js` | View-model for PI dropdown | Constructed from `DeviceRecord` |

---

## Shape: SpeakerRecord (in-memory, plugin process)

```ts
{
  contexts: string[],                  // every Stream Deck action context bound to this UUID
  operationalStatus: OperationalStatus,
  state: SpeakerState,
  updateAttempts: number[],            // epoch seconds — sliding window for rate limiting
  lastChecked: number | null,          // epoch seconds of last poll attempt
  lastUpdated: number | null,          // epoch seconds of last successful UPDATED transition
}
```

## Shape: SpeakerState

```ts
{
  audioEqualizer: { bass: number, treble: number, volume: number },  // bass/treble: -10..+10; volume: 0..100
  playMode: "NORMAL" | "REPEAT_ALL" | "REPEAT_ONE" | "SHUFFLE" | "SHUFFLE_NOREPEAT" | "SHUFFLE_REPEAT_ONE",
  playbackState: "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED" | "TRANSITIONING" | string,
  currentURI: string,                  // raw AVTransport URI; used to derive input source
  muted: boolean,
  playing?: PlayingInfo,
  queue?: Queue,
}
```

## Shape: PlayingInfo

```ts
{
  position: string,                    // hh:mm:ss
  elapsedSec: number,
  durationSec: number,
  currentTrack: number,
  title: string,
  artist: string,
  album: string,
  albumArtURI: string,                 // fully-qualified URL or local file:// path
}
```

## Shape: Queue / QueueItem

```ts
{
  start: number,
  count: number,
  list: { title, artist, album, uri, albumArtURI }[],
}
```

## Shape: DeviceRecord (persisted in global settings)

```ts
{
  primary: boolean,                    // true if this is the user-supplied discovery seed
  hostAddress: string,                 // IPv4
  port: number,                        // always 1400
  zoneName: string,                    // user-named room (e.g. "Office")
  isSatellite: boolean,                // satellite of a stereo pair / surround set
  idleState: "ACTIVE" | string,        // default "ACTIVE"
  uuid: string,                        // RINCON_xxxxxxxxxxxx01400
}
```

## Shape: Favorite (persisted in global settings)

```ts
{
  title: string,
  uri: string,                         // e.g. "x-rincon-cpcontainer:..." or "x-sonosapi-stream:..."
  metadata: string,                    // DIDL-Lite XML payload
  albumArtURI: string,
}
```

## Shape: ActionSettings (persisted per context)

```ts
{
  action: string,                      // full UUID, e.g. "com.r-teller.sonoscontroller.toggle-mute-unmute"
  states: ManifestState[],             // copy of manifest States for fast lookup
  controller: "Keypad" | "Encoder",
  uuid: string,                        // bound speaker UUID
  title: string,                       // "<zone> (<host>)"
  hostAddress: string,
  zoneName: string,
  selectedPlayModes: string[],         // toggle-play-mode only
  selectedInputSources: string[],      // toggle-input-source only
  encoderAudioEqualizerTarget: "VOLUME" | "BASS" | "TREBLE",
  displayStateBasedTitle: boolean | null,
  displayAlbumArt: boolean | null,
  displayMarqueeTitle: boolean | null,
  displayMarqueeAlbumTitle: boolean | null,
  selectedSonosFavorite: { title, uri, metadata, albumArtURI } | null,
  adjustVolumeIncrement: number | null,   // volume-up / volume-down only; null → inherit global

  // Plugin-managed transient render-dedupe / marquee state
  currentStateIndex?: number,
  marqueePositionTop?: number,
  marqueePositionBottom?: number,
  status?: {
    titleLastUpdated: number,
    lastTitleValue: string,
    lastCustomTitle: string,
    lastPlayingTitle: string,
    marqueeTitleTopValue: string,
    marqueeTitleBottomValue: string,
    albumArtURILastValue: string,
    lastAudioEqualizerBass: number,
    lastAudioEqualizerTreble: number,
    lastAudioEqualizerVolume: number,
    lastAudioEqualizerLayout: string,
  },
}
```

## Shape: GlobalSettings

```ts
{
  devices: { [uuid: string]: DeviceRecord },
  deviceCheckInterval: number,    // default 10 (sec)
  deviceTimeoutDuration: number,  // default 10 (sec) — PI label says "Actions"
  adjustVolumeIncrement: number,  // default 10, min 1; clamp Math.max(1, value) on save
  favorites: Favorite[],
}
```

---

## Enums

| Enum | Values | Used By |
|------|--------|---------|
| `OperationalStatus` | `UNINITIALIZED`, `UPDATING`, `UPDATED`, `CONNECTED`, `CONNECTING`, `DISCONNECTED`, `RATE_LIMITED` | `SpeakerRecord.operationalStatus` |
| `PlayMode` | `NORMAL`, `REPEAT_ALL`, `REPEAT_ONE`, `SHUFFLE`, `SHUFFLE_NOREPEAT`, `SHUFFLE_REPEAT_ONE` | Sonos AVTransport |
| `PlaybackState` | `PLAYING`, `PAUSED_PLAYBACK`, `STOPPED`, `TRANSITIONING`, … | Sonos AVTransport |
| `EqualizerTarget` | `VOLUME`, `BASS`, `TREBLE` | Encoder Audio Equalizer |
| `Controller` | `Keypad`, `Encoder` | Manifest action declarations |
| `InputSource` | `Sonos_Queue`, `TV_Input`, `Line_In` | Toggle Input Source state mapping |

---

## URI taxonomy (input source detection)

The current AVTransport URI is the source of truth for "what's this speaker doing":

| Prefix | Suffix | Source | Notes |
|---|---|---|---|
| `x-sonos-htastream` | `:spdif` | TV Input | HDMI/optical TV stream on Sonos soundbars |
| `x-rincon-stream` | — | Line-In | Analog input on certain models |
| `x-rincon-queue` | — | Sonos Queue | Default music-playback mode (the local queue) |
| `x-sonos-spotify:` | — | Spotify track | informational |
| `x-sonos-http:` | — | Sonos Radio | informational |
| `x-sonosapi-stream:` | — | Broadcast stream | Play Favorite uses this — skips the queue step |

`getInputSourceMappings(uri)` returns prefix/suffix factories so the toggle can construct the next URI as `<prefix>:<COORDINATOR_UUID><suffix>`.

---

## "Migration" Conventions

There is no schema migration code. The settings shape is versioned implicitly by what fields the PI writes and what fields the plugin reads. Compatibility rules:

- **Default at the read site, not the write site.** Use `??` for missing fields: `displayMarqueeTitle ?? false`, `adjustVolumeIncrement ?? 10`, `marqueeWidth || 10`. This way an upgrade from a settings blob without the field falls through to the historical default.
- **Use `??`, not `||`, for numeric fields.** `||` treats `0` and `1` as falsy and silently replaces them — that bug already shipped once for `adjustVolumeIncrement` (resolved in PR #4). Always reach for `??` on numeric overrides.
- **Never rename a settings field.** Renames break every previously-placed button. Add a new field, dual-read for one release, then drop the old reader.
- **Clamp on write, not on read.** `Math.max(1, value)` for `adjustVolumeIncrement` happens in `saveGlobalSettings`. The HTML `min="1"` attribute is bypassable in the Electron webview's `v-model.number` binding.
- **Treat manifest state list as a snapshot.** `ActionSettings.states` is a copy of the action's manifest States, persisted at `willAppear` time. The plugin reads from this copy rather than re-reading the manifest, so the rebuild must keep state names stable.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Speaker identity | Sonos UUID (`RINCON_…`) | Stable across DHCP changes within a session |
| IP address handling | Resolved at discovery, persisted in global settings | Stale on IP change; user must re-run discovery to refresh |
| State source of truth | Polling, not UPnP NOTIFY subscriptions | Simpler; trades latency for fewer moving parts; 7 SOAP calls every 10 s per speaker |
| Per-button override resolution | `adjustVolumeIncrement ?? globalAdjustVolumeIncrement` | `??` preserves `1`; `\|\|` does not |
| Coordinator selection for transport | Coordinator of the bound speaker's group | Required for multi-group households (current code uses "first ZoneGroup" — the rebuild must fix this) |
| XML→JSON shape normalization | `[].concat(value || [])` at every iteration | XML→JSON converter collapses single children to objects, not one-element arrays |
| Render dedupe scope | Per-field (image, state, title, feedback) | Prevents flashing on the SD+ LCD which redraws on every push |
| Marquee dedupe scope | Source string, not per-frame substring | Marquee animation is intentionally one frame per tick |
| Coordinator/group exposure | Internal only | Not exposed in PI in MVP — out of scope |
| Live state persistence | Not persisted across plugin restarts | Rebuilt from polling on next start |
