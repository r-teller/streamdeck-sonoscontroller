# Sonos Controller for Stream Deck — Cleanroom Product Requirements Document (WHAT)

Document type: PRD (intent and behavior)
Audience: Engineering team rebuilding the product from scratch with no access to the existing source code
Author voice: Product Management

---

## 1. Product Overview & Intent

### 1.1 Elevator pitch

Sonos Controller is an Elgato Stream Deck plugin that turns the dedicated keys, encoders (rotary dials), and touch strip of a Stream Deck device into a tactile, always-visible control surface for any number of Sonos speakers on the user's local network. The user picks a discovered speaker for each key or dial, and that key then performs one Sonos operation — toggle mute, play/pause, skip track, switch input source, change play mode, play a Sonos favorite, raise/lower volume, or adjust an equalizer band — while showing the speaker's live state (playing/paused/muted, current play mode, current input source, current track title and album art) on the key face or dial display.

### 1.2 Problem it solves

Sonos's official mobile and desktop apps are great for browsing music but heavy for one-handed, glance-and-tap control. Power users who sit at a desk or in a media room frequently want to mute a speaker mid-call, skip a song, swap to TV input, or nudge the volume — without context-switching to a phone. A Stream Deck gives them physical buttons, but Elgato ships no first-party Sonos integration. This plugin fills that gap.

### 1.3 Target user

A consumer or enthusiast who:
- Owns one or more Sonos speakers on a single LAN.
- Owns at least one Stream Deck device (Classic, XL, Mini, Mobile, +, or Pedal — the plugin's actions vary by which controllers the device offers).
- Wants per-button control of a specific speaker rather than navigating a music app.
- Is comfortable identifying the IP address of one Sonos speaker for the initial setup ("discovery seed").

### 1.4 Value proposition

- Single-tap, glance-able control of any Sonos speaker on the LAN.
- One-time setup: enter one Sonos IP, the plugin discovers the rest.
- Live state shown on the key face — the user always knows whether a speaker is playing, muted, what input it's on, and what's playing.
- Stream Deck+ users get a continuous-control surface (rotary dial) for volume, bass, and treble with a graphical bar indicator.
- Per-action customization (e.g., choose which play modes are part of the toggle cycle, choose which input sources cycle, choose which Sonos favorite to play).

---

## 2. Glossary

### 2.1 Stream Deck terminology

- **Stream Deck device**: Elgato hardware (or mobile app) with a grid of LCD keys, possibly also rotary encoders with small LCD displays and a touch strip.
- **Action**: A reusable unit of behavior the user can drag onto a key or dial. An action has a name, an icon, a tooltip, one or more visual states, and a Property Inspector.
- **Key (Keypad controller)**: A square LCD button. Generates `keyDown` / `keyUp` events.
- **Encoder / Dial**: A rotary knob with a small LCD above it (Stream Deck+). Generates `dialRotate`, `dialDown`, `dialUp`, and `touchTap` events. Has a feedback layout that defines the LCD's visual composition (icon, title, value text, indicator bar).
- **Touch strip / Touch tap**: The horizontal LCD area above the encoders on Stream Deck+. Tapping it emits `touchTap` for the dial directly above the tap point.
- **State**: A named visual configuration of an action (image + title alignment + font size). An action with multiple states changes its key face by switching state index.
- **Property Inspector (PI)**: The settings panel that opens to the right of the Stream Deck app when the user selects a placed action. Implemented as an HTML page.
- **Manifest**: A JSON file declaring the plugin's identity, every action it offers, its icons, supported OS, supported Stream Deck software version, etc.
- **Context**: An opaque per-instance identifier the Stream Deck SDK assigns to each placed action on each device. The plugin uses contexts to address `setState`, `setTitle`, `setImage`, `setFeedback`, etc.
- **Global settings**: A JSON blob the plugin can persist at the plugin scope (shared across all action instances).
- **Per-action settings**: A JSON blob persisted per action instance (per context).
- **Profile**: A page of action placements the user assembles in the Stream Deck app.

### 2.2 Sonos terminology

- **Speaker / Player / Zone Player**: A single Sonos device (a Play:1, Beam, Move, Era, etc.). Identified by a UUID like `RINCON_…`.
- **Zone**: The user-named room a speaker is assigned to (e.g., "Kitchen", "Office").
- **Group / Zone Group**: One or more zones playing in sync. One member is the **coordinator**.
- **Coordinator**: The speaker in a group that originates the audio stream and accepts transport commands on behalf of the group.
- **Satellite**: A speaker that is part of a stereo pair, surround setup, or sub-bonded configuration. Satellites are not directly controllable as standalone players; the bonded/stereo "primary" handles transport.
- **Household**: All Sonos devices on a single LAN that have been bound to one Sonos system.
- **Transport**: The play/pause/stop/seek/next/previous control surface of a player, addressed via the AVTransport service.
- **Queue**: The ordered list of items the speaker will play in "queue" mode.
- **Favorite**: A user-saved item in the Sonos app (radio station, playlist, album, track) with a fixed URI and metadata.
- **Line-In**: An analog input source on certain Sonos models.
- **TV Input**: The HDMI/optical TV stream on Sonos soundbars.
- **Sonos Queue (input source)**: The local queue is being played (default music playback mode).
- **Play Mode**: One of NORMAL, REPEAT_ALL, REPEAT_ONE, SHUFFLE, SHUFFLE_NOREPEAT, SHUFFLE_REPEAT_ONE.

### 2.3 Product-specific terms

- **Discovery device / Primary device**: The first Sonos speaker the user provides an IP for. Used as the entry point to enumerate the rest of the household.
- **Selected Sonos speaker**: The speaker bound to a specific action instance.
- **Marquee title**: A scrolling text label rendered onto a key, used when the title is longer than will fit.
- **State-based title**: A short auto-generated label derived from the action's current state name (e.g., "Playing", "Muted", "Shuffle").
- **Operational status**: An internal lifecycle marker for each speaker (UNINITIALIZED, UPDATING, UPDATED, CONNECTED, CONNECTING, DISCONNECTED, RATE_LIMITED) that gates polling and error display.

---

## 3. System Context

### 3.1 Where it runs

- An Elgato Stream Deck plugin packaged as a `.streamDeckPlugin` bundle.
- Runs on macOS (10.11+) and Windows (10+), inside the Stream Deck application's plugin host.
- Minimum Stream Deck application version: 6.5.
- Plugin background code executes in a Node.js 20 runtime hosted by the Stream Deck app.
- Property Inspector executes inside an embedded webview.

### 3.2 External systems

- **Stream Deck SDK** (WebSocket-based event protocol): Two distinct connections — one for the plugin background, one for the Property Inspector. The plugin communicates with the host to register itself, receive user input events (`keyDown`, `dialRotate`, `dialDown`, `touchTap`, `willAppear`, `willDisappear`, `didReceiveSettings`, `didReceiveGlobalSettings`, `systemDidWakeUp`, etc.) and to push UI updates (`setState`, `setTitle`, `setImage`, `setFeedback`, `setFeedbackLayout`, `showAlert`, `showOk`, `setSettings`, `setGlobalSettings`).
- **Sonos local network API (UPnP/SOAP over HTTP, port 1400)**: The plugin talks directly to Sonos speakers on the LAN. No cloud account is required. No Sonos OAuth. Services used:
  - `ZoneGroupTopology` (discover all members of the household and their coordinators)
  - `AVTransport` (play, pause, next, previous, set play mode, set transport URI, get media info, get position info, get transport info, remove all tracks from queue, seek, add URI to queue)
  - `RenderingControl` (get/set mute, volume, bass, treble; set relative volume)
  - `DeviceProperties` (get zone attributes, zone info)
  - `ContentDirectory` (browse favorites, browse queue)
  - `AudioIn` (referenced but not actively used by the current MVP)

### 3.3 Discovery & auth assumptions

- No authentication. The Sonos local API on port 1400 is unauthenticated for users on the same LAN.
- No multicast SSDP discovery is performed by the plugin itself — the user must supply one Sonos speaker's IP (the "discovery seed"). From that one speaker the plugin enumerates the entire household via `GetZoneGroupState`.
- IP addresses of discovered speakers are taken from the `Location` URL each member advertises in zone-group state.
- Speakers are identified by their Sonos UUID (e.g., `RINCON_xxxxxxxxxxxx01400`) so they remain stable even if their IP changes between sessions (the user must re-run discovery to refresh IPs if a DHCP lease changes).
- **Household size must not affect discovery.** Every supported household topology must enumerate correctly:
  - One zone group, one speaker (e.g., a standalone Sonos Move or Roam used by itself).
  - One zone group, multiple speakers (one stereo pair, or a home-theater set with satellites/sub).
  - Multiple zone groups, mixed sizes.
  - The discovery flow must defensively normalize **every** iteration over `ZoneGroup`, `ZoneGroupMember`, and `Satellite` to handle the single-element case — the underlying XML→JSON conversion collapses single children to a plain object rather than a one-element array. A single iteration site that forgets this normalization will surface to the user as `Failed to get devices: <name> is not iterable` and block all setup.
  - Acceptance: discovery must succeed against (a) a household consisting of exactly one Sonos Move or one Sonos Roam, (b) a household with one stereo pair, (c) a household with a home theater group containing a soundbar + sub + two surround satellites.

### 3.4 Supported Stream Deck device families

The plugin must work with any Stream Deck device. Behavior per family:

| Device family | Has Keypad | Has Encoder | Notes |
|---|---|---|---|
| Stream Deck Mini | Yes | No | All Keypad-only actions available. |
| Stream Deck (Classic 15-key) | Yes | No | All Keypad-only actions available. |
| Stream Deck XL | Yes | No | All Keypad-only actions available. |
| Stream Deck + (Plus) | Yes | Yes (4 dials + touch strip) | All actions available, including the encoder-only Audio Equalizer. |
| Stream Deck Pedal | Keypad-equivalent (no display) | No | Keypad actions can be invoked; visual state is irrelevant. |
| Stream Deck Mobile (iOS/Android app) | Yes | No | Keypad actions available. |

Encoder-only actions must not be droppable on devices without encoders. Keypad-only actions must not be droppable on the encoder/touch strip.

---

## 4. Personas & Top User Journeys

### 4.1 Persona A — "Casey, the WFH desk worker"

Owns a Sonos Era 100 in the home office and a Sonos Beam in the living room. Has a Stream Deck XL on the desk. Wants two columns of buttons: one for the office speaker (mute, play/pause, volume up, volume down, skip, play favorite "Lo-Fi Radio") and one for the living room speaker (the same set, but bound to the Beam).

### 4.2 Persona B — "Morgan, the home theater enthusiast"

Owns a Sonos Arc + Sub + One SLs and a Stream Deck +. Wants a dedicated dial for living-room volume, plus one key to flip between TV input and Sonos Queue, plus a "what's currently playing" tile that shows the album art and scrolling track name.

### 4.3 Top user journeys

1. **First-run setup.** Casey installs the plugin from the Stream Deck Marketplace (or by double-clicking a downloaded `.streamDeckPlugin`), opens the Stream Deck app, drags any Sonos action onto a key, and sees the Property Inspector prompting for a "Primary Device Address (Discovery)". Casey enters `192.168.1.42`, taps "Save and Connect". The plugin discovers all speakers in the household, populates the speaker dropdown, and pre-selects the discovery speaker as the default for any new actions.

2. **Bind a key to a specific speaker's mute toggle.** Casey drags "Toggle Mute" onto a key. The PI shows the discovered speakers in a list. Casey picks "Office (192.168.1.42)". Saves. The key now displays a muted/unmuted icon, updates within ~10 seconds whenever the speaker's mute state changes (e.g., from the Sonos app), and tapping it toggles mute.

3. **Configure a Stream Deck+ dial as a volume knob.** Morgan drags "Audio Equalizer" onto a dial. The PI shows the speaker picker plus an "Equalizer Target" dropdown with options Volume, Bass, Treble. Morgan picks "Volume". The dial display now shows a 0–100 horizontal bar with the current volume; rotating the dial CW raises volume by ~1 per tick (batched), CCW lowers it. Selecting "Bass" or "Treble" changes the indicator to a bipolar -10 / +10 colored gradient bar.

4. **Use a single key to cycle play modes.** Casey drags "Toggle Play Mode" onto a key. In the PI, Casey unchecks "Shuffle Repeat One" and "Repeat One" (Casey doesn't want those modes in the cycle). Pressing the key now cycles only between Normal → Shuffle Norepeat → Shuffle → Repeat All → Normal …. The key icon and label update to reflect the current mode.

5. **Play a Sonos favorite at a tap.** Casey drags "Play Sonos Favorite". The PI shows a dropdown of all favorites previously saved via the Sonos app. Casey picks "Morning Jazz". Pressing the key clears the queue, queues the favorite, and starts playback. Optionally, Casey enables "Display Album Art" and "Display Marquee Title" so the key displays the current track name scrolling under the album cover.

6. **Switch the Beam between TV input and music.** Morgan drags "Toggle Input Source", picks the Beam, and leaves all three sources (Sonos Queue, TV Input, Line-In) checked. Pressing the key cycles through the available sources; the icon and label update to match.

7. **Glanceable now-playing tile.** Morgan drags "Currently Playing" onto a key. It is read-only by intent — pressing it just forces an immediate refresh of the speaker state. The key shows the album art with the track title scrolling below it (when configured).

---

## 5. Functional Requirements — Action Catalog

The plugin exposes ten user-droppable actions plus a special read-only "Currently Playing" tile. All actions live under a single category named "Sonos Controller" in the Stream Deck app's action sidebar. The category has its own icon (a stylized speaker).

For every action below:
- The action's `Property Inspector Path` is the same shared HTML page (the PI dynamically renders the appropriate controls based on the current action's UUID).
- `User Title Enabled` is `false` for every action except "Play Sonos Favorite", because the plugin renders titles itself based on state. Letting the user set their own static title would conflict with state-based or marquee titles.
- `Disable Automatic States` is `true` for every action — the plugin sets the state index explicitly via the Stream Deck SDK.
- `Disable Caching` is `true` for every action except "Play Sonos Favorite" — the plugin overwrites the key image (album art, etc.) at runtime and must not be served a cached image.
- Every action calls into the live Sonos speaker on every press; commands have a configurable timeout (default 10 seconds — see §6) and on failure the key shows the standard "alert" indicator and the speaker enters DISCONNECTED state until the next polling tick succeeds.

Action UUIDs use the namespace `com.r-teller.sonoscontroller.<short-name>` and must match those listed below verbatim so that previously placed buttons survive a clean rebuild.

### 5.1 Currently Playing

| Field | Value |
|---|---|
| Display name | Currently Playing |
| Action UUID | `com.r-teller.sonoscontroller.currently-playing` |
| Tooltip | "Display the currently playing state of the selected speaker and action will manually refresh state" |
| Supported controllers | Keypad |
| Action sidebar icon | "currently_playing" (Material Design `spatial_tracking`) |
| User Title Enabled | false |
| Disable Automatic States | true |
| Disable Caching | true |
| States | one — "Currently_Playing"; image `keys/currently_playing`; title alignment top; font size 11 |

Purpose & user value: A glanceable now-playing tile. Shows the speaker's current album art, current track title (optionally scrolling marquee), and current input source.

Behavior on key press: Force an immediate refresh of the bound speaker's state (i.e., re-issue the multi-call status fetch outside the normal polling cadence). Does not change playback in any way.

Visual rules:
- If the speaker is on TV input: the key shows the TV-input icon and the title "TV".
- If the speaker is on Line-In: the key shows the line-in icon and the title "Line In".
- Otherwise (Sonos Queue): the key shows the album art of the currently playing track and the title "Queue" (or, if the user enabled the marquee toggles, the actual track title scrolling).

PI settings (in addition to the universal speaker picker, see §7):
- Display State Based Title: not applicable to this action (hidden).
- Display Album Art (boolean, default false).
- Display Marquee Title (boolean, default false): scroll the current track title across the key.
- Display Marquee Album Title (boolean, default false): scroll the album name as a second line.

Polling: refreshed by the global polling loop (default every 10s).

### 5.2 Toggle Mute

| Field | Value |
|---|---|
| Display name | Toggle Mute |
| Action UUID | `com.r-teller.sonoscontroller.toggle-mute-unmute` |
| Tooltip | "Toggle mute state between muted and unmuted." |
| Supported controllers | Keypad |
| Action sidebar icon | "muted" (Material `volume_off`) |
| States | "Unmuted" (image `keys/unmuted`, title alignment top) and "Muted" (image `keys/muted`, title alignment top); font size 11 |

Purpose: One-tap mute/unmute of the bound speaker.

Behavior on key press: Read current mute state, send `RenderingControl::SetMute` with the inverted boolean, optimistically update the key state.

State mapping: the speaker's `CurrentMute = 1` shows the "Muted" state image; `0` shows the "Unmuted" image.

Optional title overlay: if "Display State Based Title" is on, the key title shows "Muted" or "Unmuted".

### 5.3 Toggle Play/Pause

| Field | Value |
|---|---|
| Display name | Toggle Play/Pause |
| Action UUID | `com.r-teller.sonoscontroller.toggle-play-pause` |
| Tooltip | "Toggle play/pause state between playing and paused." |
| Supported controllers | Keypad |
| Action sidebar icon | "paused" (Material `motion_photos_pause`) |
| States | "Paused" (image `keys/paused`), "Playing" (image `keys/playing`), "Stopped" (image `keys/stopped`); all top-aligned, font size 11 |

Behavior: If the current transport state is PLAYING, send `Pause`; otherwise send `Play`. STOPPED maps to the "Stopped" state image but a press still sends `Play`.

State mapping: AVTransport `CurrentTransportState` of `PLAYING`, `PAUSED_PLAYBACK`, `STOPPED` — anything else falls back to "Stopped".

PI options exposed (in addition to universal speaker picker):
- Display State Based Title (boolean) — overlay "Playing" / "Paused" / "Stopped".
- Display Marquee Album Title (boolean) — second line scrolls the album name.
- Display Album Art (boolean).

### 5.4 Toggle Play Mode

| Field | Value |
|---|---|
| Display name | Toggle Play Mode |
| Action UUID | `com.r-teller.sonoscontroller.toggle-play-mode` |
| Tooltip | "Toggle play mode between normal, shuffle and repeat." |
| Supported controllers | Keypad |
| Action sidebar icon | "shuffle" (Material `shuffle`) |
| States (6) | Normal (`keys/play_normal`), Shuffle_NoRepeat (`keys/shuffle_no_repeat`), Shuffle_Repeat_One (`keys/shuffle_one`), Shuffle (`keys/shuffle_on`), Repeat_One (`keys/repeat_one`), Repeat_All (`keys/repeat_all`); all bottom-aligned, font size 11 |

Behavior: Cycle through the user-selected subset of play modes. The PI shows six checkboxes, one for each mode; the user can disable any modes they don't want in the cycle. On press, find the speaker's current play mode in the user's selected list, advance to the next one (wrapping). If the speaker is currently in a mode the user has unchecked, fall back to the first selected mode.

State mapping: Sonos's reported play mode (`NORMAL`, `SHUFFLE_NOREPEAT`, `SHUFFLE_REPEAT_ONE`, `SHUFFLE`, `REPEAT_ONE`, `REPEAT_ALL`) is matched case-insensitively to the corresponding state name.

PI checkbox label format: state name with underscores replaced by spaces and each word title-cased ("Shuffle No Repeat", "Shuffle Repeat One", etc.). Default selection: all six checked.

State-based title overrides for compactness:
- Shuffle_NoRepeat → "Shuffle 0"
- Shuffle_Repeat_One → "Shuffle 1"
- Repeat_One → "Repeat 1"
- Repeat_All → "Repeat"

### 5.5 Toggle Input Source

| Field | Value |
|---|---|
| Display name | Toggle Input Source |
| Action UUID | `com.r-teller.sonoscontroller.toggle-input-source` |
| Tooltip | "Toggle input source between line-in, aux and usb." |
| Supported controllers | Keypad |
| Action sidebar icon | "input_source" (Material `settings_input_component`) |
| States (3) | Sonos_Queue (`keys/input_sonos_queue`), TV_Input (`keys/input_tv`), Line_In (`keys/input_line_in`); all top-aligned, font size 11 |

Behavior: Cycle through user-selected input sources. The cycle uses the same enabled/disabled checkbox pattern as Toggle Play Mode. The action determines current source by inspecting the current AVTransport URI prefix:
- prefix `x-sonos-htastream` and suffix `:spdif` → TV Input
- prefix `x-rincon-stream` → Line-In
- otherwise → Sonos Queue

On press, the next selected source is generated as `<prefix>:<COORDINATOR_UUID><suffix>` and submitted via `SetAVTransportURI`. After switching, immediately call `Play` so the speaker actually begins playback on the new source.

State-based title overrides:
- Sonos_Queue → "Queue"
- TV_Input → "TV"
- Line_In → "Line-In"

### 5.6 Play Next Track

| Field | Value |
|---|---|
| Display name | Play Next Track |
| Action UUID | `com.r-teller.sonoscontroller.play-next-track` |
| Tooltip | "Skip to next track in queue" |
| Supported controllers | Keypad |
| Action sidebar icon | "next_track" (Material `skip_next`) |
| States | one — "Next_Track" (`keys/next_track`), top-aligned, font size 11 |

Behavior: Send `AVTransport::Next`. No state cycling.

### 5.7 Play Previous Track

| Field | Value |
|---|---|
| Display name | Play Previous Track |
| Action UUID | `com.r-teller.sonoscontroller.play-previous-track` |
| Tooltip | "Skip to previous track in queue" |
| Supported controllers | Keypad |
| Action sidebar icon | "previous_track" (Material `skip_previous`) |
| States | one — "Previous_Track" (`keys/previous_track`), top-aligned, font size 11 |

Behavior: Send `AVTransport::Previous`.

### 5.8 Volume Up

| Field | Value |
|---|---|
| Display name | Volume Up |
| Action UUID | `com.r-teller.sonoscontroller.volume-up` |
| Tooltip | "Increase volume" |
| Supported controllers | Keypad |
| Action sidebar icon | "volume_up" (Material `expand_less`) |
| States | one — "Volume_Up" (`keys/volume_up`), top-aligned, font size 11 |

Behavior: Read current volume; new volume = `min(100, current + increment)`; send `SetVolume`. Increment resolution: per-button override (if the user filled in the optional override field) → global "Volume Increment (Up/Down)" setting (default 10, minimum 1). There is no further fallback — the global default is always present.

Settings exposed in the Property Inspector:

| Label | Type | Default | Validation | Description |
|---|---|---|---|---|
| Volume Increment — "Override increment (leave empty to use global default)" | number, optional | empty (inherit global) | minimum 1 | Helper text: "Volume range: 0–100". Placeholder shows the current global default (e.g., "Global default: 10"). Leaving the field empty means this button uses whatever the global setting is at the time the press is handled. Entering a value (including 1) overrides the global value for this button only. Changes to the global value do not affect a button that has an override set. |

### 5.9 Volume Down

| Field | Value |
|---|---|
| Display name | Volume Down |
| Action UUID | `com.r-teller.sonoscontroller.volume-down` |
| Tooltip | "Decrease volume" |
| Supported controllers | Keypad |
| Action sidebar icon | "volume_down" (Material `expand_more`) |
| States | one — "Volume_Down" (`keys/volume_down`), top-aligned, font size 11 |

Behavior: New volume = `max(0, current - increment)`; send `SetVolume`. Increment resolution: identical to Volume Up — per-button override (optional) → global "Volume Increment (Up/Down)" setting (default 10, minimum 1).

Settings exposed in the Property Inspector: same optional "Volume Increment" override field as Volume Up (§5.8). Volume Up and Volume Down read the same global default and each have their own independent per-button override.

### 5.10 Play Sonos Favorite

| Field | Value |
|---|---|
| Display name | Play Sonos Favorite |
| Action UUID | `com.r-teller.sonoscontroller.play-sonos-favorite` |
| Tooltip | "Play Sonos favorite" |
| Supported controllers | Keypad |
| Action sidebar icon | "play_favorite" (Material `playlist_play`) |
| States | one — "Play Favorite" (`keys/play_favorite`), top-aligned, font size 11 |
| User Title Enabled | true (only action where this is true) |
| Disable Caching | false (only action where this is false) |

Behavior on key press:
1. Clear the speaker's queue (`RemoveAllTracksFromQueue`).
2. Set the favorite as the queue source (`AddURIToQueue` then `SetAVTransportURI x-rincon-queue:<COORDINATOR>#0`, then `Seek TRACK_NR 1`). For radio-stream favorites (URI prefix `x-sonosapi-stream:`) skip the queue step and call `SetAVTransportURI` directly.
3. Send `Play`.

PI surfaces a dropdown of Sonos favorites discovered during global setup. The selected favorite's `title`, `uri`, `metadata`, and `albumArtURI` are stored in the action's settings and used at press time.

Optional visual extras:
- Display Album Art — show the favorite's album art on the key.
- Display Marquee Title — scroll the favorite's title under the album art.

### 5.11 Audio Equalizer (Stream Deck+ Encoder only)

| Field | Value |
|---|---|
| Display name | Audio Equalizer |
| Action UUID | `com.r-teller.sonoscontroller.encoder-audio-equalizer` |
| Tooltip | "Adjust audio equalizer settings" |
| Supported controllers | Encoder |
| Action sidebar icon | "equalizer" (Material `graphic_eq`) |
| States | one — "Audio Equalizer" (`keys/equalizer`) |
| Encoder rotate description | "Equalizer" |

Behavior:
- The user picks one Equalizer Target in the PI: Volume, Bass, or Treble.
- Rotate clockwise: increment the target by 1 unit per tick. Rotate counter-clockwise: decrement by 1 unit per tick.
  - Volume: clamped to [0, 100].
  - Bass / Treble: clamped to [-10, +10].
- Rotation events are batched: ticks accumulated within a 300ms window are summed and sent as a single SOAP call so a fast spin doesn't flood the network.
- Dial press / dial up: no-op in MVP (no behavior bound).
- Touch tap on the touch strip above this dial: triggers a re-read / refresh of the speaker state (acts like the "Currently Playing" press).

Feedback layout (what appears on the small LCD above the dial):
- Title text (top): the selected target name in upper case ("VOLUME", "BASS", "TREBLE"), centered, weight 600, font size 16.
- Icon (left): the equalizer key image.
- Value text (right): the current numeric value, right-aligned, font size 24, weight 600.
- Indicator (bottom):
  - For Volume: a horizontal bar from 0 to 100 (filled bar, no border).
  - For Bass / Treble: a bipolar gradient bar from -10 to +10, colored red→yellow→green so the center (0) is yellow, negative is red, positive is green.
- The plugin must switch the layout (`setFeedbackLayout`) automatically when the user changes the Equalizer Target between Volume and Bass/Treble, since they use different layouts.

---

## 6. Global / Plugin-Wide Settings

These are persisted at the plugin scope (shared across every placed action) and edited from the universal "Global Settings" panel that appears in every action's PI.

| Setting | Type | Default | Validation | Description shown to user |
|---|---|---|---|---|
| Primary Device Address (Discovery) | text (IPv4 or hostname) | empty | non-empty before "Save and Connect" can be tapped | "Note: This device is used to discover all other devices on the network" |
| Device Timeout Duration (Actions) | number, seconds | 5 (used for polling) and 10 (used for action commands; the PI label calls this "Actions") | positive integer | "Note: This timeout is used when executing device actions (in seconds)" |
| Device Check Interval (Actions) | number, seconds | 10 | positive integer | "Note: This interval is used to check the status of the device selected for this action (in seconds)" |
| Volume Increment (Up/Down) | number | 10 | minimum 1 (values below 1 must be silently clamped to 1 on save, since the underlying input control may not enforce the minimum) | "Note: Volume range is 0–100. Used by Volume Up and Volume Down actions unless overridden per-button." |
| devices | object (UUID → device record) | populated by discovery | not user-editable | Discovered Sonos players. Each record stores: `primary` (boolean), `hostAddress` (string IP), `port` (1400), `zoneName` (string), `isSatellite` (boolean), `idleState` (string, "ACTIVE" by default), `uuid` (string). |
| favorites | array of favorite records | populated by discovery | not user-editable | Each record: `title`, `uri`, `metadata` (XML), `albumArtURI`. |

Saving global settings is initiated by the user pressing the "Save and Connect" button (text becomes "Save and Reconnect" once connected). When tapped, the PI:
1. Connects to the discovery device.
2. Calls `GetZoneGroupState` and parses every `ZoneGroupMember` and any `Satellite` children. Marks the discovery device as `primary`.
3. Calls `Browse FV:2` to enumerate Sonos favorites.
4. Persists the result via `setGlobalSettings`.
5. Refreshes the speaker dropdown in the current PI.

Per-action settings (persisted per context) include:
- `action` — the action UUID
- `controller` — "Keypad" or "Encoder"
- `states` — copy of the action's manifest state list (for fast lookup without re-reading the manifest)
- `uuid`, `title`, `hostAddress`, `zoneName` — the bound speaker
- `selectedPlayModes` — array of enabled play mode names (Toggle Play Mode only)
- `selectedInputSources` — array of enabled input source names (Toggle Input Source only)
- `encoderAudioEqualizerTarget` — "VOLUME" / "BASS" / "TREBLE"
- `displayStateBasedTitle` (boolean or null when not applicable to this action)
- `displayAlbumArt` (boolean or null)
- `displayMarqueeTitle` (boolean or null)
- `displayMarqueeAlbumTitle` (boolean or null)
- `selectedSonosFavorite` — `{title, uri, metadata, albumArtURI}` for Play Sonos Favorite

---

## 7. Property Inspector UX Requirements

The PI is a single panel reused by every action. Its visible content adapts to the current action's UUID. It uses a dark theme.

### 7.1 Top-of-panel — "Sonos Speakers" group

- Heading: "Sonos Speakers".
- Inside an accordion section labeled "Available Sonos Speakers" (collapsible). The accordion is collapsed by default once a connection has been established.
  - A small grey hint line: "Note: Devices marked with 🛰️ are satellites" — always visible above the picker.
  - A multi-line `<select size=5>` list showing all discovered speakers. Each option label is `<ZoneName> (<HostAddress>) [🛰️ if satellite]`. List is sorted case-insensitively by label.
  - Below the list, a free-text "Filter by name or Sonos Speaker ID..." input. Filter matches on the label or UUID, case-insensitive.
- Below the accordion, a light alert box that always shows the currently selected speaker's title, e.g., `Office (192.168.1.42)`. This makes the binding visible even when the picker accordion is collapsed.

### 7.2 Per-action presentation toggles (only shown when applicable)

The following four switches each render only when the current action is in the action's allow-list:

- "Display State Based Title" — shown for: Toggle Play Mode, Toggle Input Source, Toggle Play/Pause, Toggle Mute, Volume Up, Volume Down, Play Previous Track, Play Next Track.
- "Display Marquee Title" — shown for: Play Sonos Favorite, Currently Playing.
- "Display Marquee Album Title" — shown for: Toggle Play/Pause, Currently Playing.
- "Display Album Art" — shown for: Toggle Play/Pause, Play Sonos Favorite, Currently Playing.

All four default to off. Toggling any of them auto-saves the action's settings.

### 7.3 Action-specific configuration sections

These render conditionally based on the current action UUID (titled `h1`):

- **"Play Mode(s)"** (Toggle Play Mode only): six switches in a vertical stack — Normal, Shuffle No Repeat, Shuffle Repeat One, Shuffle, Repeat One, Repeat All. All checked by default. Each toggle auto-saves.
- **"Input Source(s)"** (Toggle Input Source only): three switches — Sonos Queue, Tv Input, Line In. All checked by default. Each toggle auto-saves.
- **"Equalizer Target"** (Audio Equalizer only): a single dropdown with options Volume, Bass, Treble. Default Volume. Auto-saves.
- **"Sonos Favorite(s)"** (Play Sonos Favorite only): a single dropdown listing every Sonos favorite from global settings, by title. Default first favorite. Auto-saves.

### 7.4 Bottom — "Global Settings" group

- Heading: "Global Settings".
- An accordion containing one section "Global Settings" (auto-expanded when not yet connected, collapsed once connected).
  - Four labeled inputs (see §6): Primary Device Address (Discovery), Device Timeout Duration (Actions), Device Check Interval (Actions), Volume Increment (Up/Down). Each label has a small grey explanatory hint underneath.
  - If a connection error has been raised, an inline red dismissible alert above the form shows the error message.
- A "Save and Connect" / "Save and Reconnect" button (right-aligned, primary color). Disabled when:
  - Primary Device Address is empty.
  - A connection attempt is currently in flight (button shows a small spinner and remains disabled until done).

### 7.5 Empty / disconnected state

When no global discovery has succeeded yet, the speakers list and per-action sections are hidden — only the Global Settings accordion is visible (auto-expanded), with the discovery field empty and the "Save and Connect" button visible.

### 7.6 Selected-speaker default behavior

When a brand-new action is dropped onto a key, its bound speaker defaults to the discovery (primary) speaker. The user can re-bind it to any other discovered speaker.

### 7.7 Validation & error messaging

- Discovery save failures (timeout, no response, malformed XML) are surfaced as a dismissible red alert in the Global Settings accordion ("Failed to get devices: Timeout while getting devices after 10 seconds").
- The PI never silently fails. Either it succeeds (button label flips to "Save and Reconnect") or it shows the alert above the inputs.
- The error alert text comes from the underlying exception's `message` property. Any user-visible exception must therefore carry a message that names the actionable cause (e.g., "Timeout while getting devices after 10 seconds", "Could not reach 192.168.1.42:1400") rather than a programmer artifact like "u is not iterable" or "Cannot read property 'x' of undefined". The rebuild must wrap raw exceptions and translate them at the boundary before showing them to the user.

---

## 8. Non-Functional Requirements

### 8.1 Performance

- The PI must populate the speaker list and favorites within `Device Timeout Duration` of the user pressing "Save and Connect" (default 10 seconds). If discovery exceeds the timeout, an error alert is shown.
- A speaker's state on the key (mute icon, play/pause icon, current play mode) must reflect a remote change (e.g., from the Sonos app) within `Device Check Interval` seconds (default 10 s) plus one round-trip's worth of latency.
- The polling supervisor scans all known speakers every 500 ms but only issues a network call to a given speaker if its `secondsLastChecked >= Device Check Interval` and it is not currently `UPDATING` or `RATE_LIMITED`.
- An action button press must call out to the speaker within ~50 ms (no spin-up cost), and the optimistic visual update must occur before the network call completes (e.g., the mute icon changes immediately on press; if the call fails, the alert indicator flashes).
- Encoder rotation must be coalesced into 300 ms windows — a single Sonos `SetVolume` call per window.

### 8.2 Visual stability (no flashing)

The plugin must not visibly redraw a key or dial when the displayed state has not changed. Specifically:

- For every key/dial, the plugin must remember the last value pushed for `setImage`, `setState` (state index), `setTitle`, and `setFeedback` (per-field). On each poll tick, it must compare the newly-derived render values to those last-pushed values and only emit the SDK call when a value has actually changed.
- This applies in particular to actions whose render is derived from polled Sonos state — Currently Playing, Toggle Play Mode, Toggle Mute, Toggle Play/Pause, Toggle Input Source, and the Audio Equalizer encoder. Without dedupe, every poll re-pushes the current image/title and the Stream Deck+ LCD flashes on every cycle.
- Marquee animations are an explicit exception: when a marquee is active, title updates are *expected* every render frame and dedupe must be scoped to the underlying source string, not the per-frame substring.
- Acceptance: with a key bound to a stable Sonos state (paused, fixed track, no marquee), no visible redraw occurs across at least 60 seconds of polling.

### 8.3 Reliability

- A speaker may go offline (powered down, network drop, IP changed). The plugin must:
  1. Cancel the in-flight call on timeout.
  2. Mark the speaker `DISCONNECTED`.
  3. Show the standard "alert" indicator on every key/dial bound to that speaker.
  4. Resume normal polling when the speaker becomes reachable again (the alert indicator clears on the next successful update).
- Rate limiting: if more than 3 update attempts on a single speaker occur within a 10-second window, the plugin sets the speaker's status to `RATE_LIMITED` and skips polling until the count drops back below the threshold. This prevents tight retry loops during a sustained outage.
- The plugin must survive `systemDidWakeUp` (machine resumed from sleep) without losing speaker state — it should naturally re-converge as polling resumes.
- The Stream Deck SDK uses Web Workers for timers so that browser tab throttling does not stall polling intervals when the Stream Deck app loses focus.
- Discovery and group enumeration must be robust to single-element vs. multi-element response shapes. Specifically: a household that returns exactly one zone group, one zone-group member, or one satellite must be handled identically to one that returns many. The rebuild must not assume the response is always a list.

### 8.4 Localization

- English only in the MVP. All user-facing strings are English. No i18n keys required for a v1 rebuild.

### 8.5 Accessibility

- The PI uses standard form controls (HTML `select`, `input`, checkboxes, switches), which inherit the host webview's accessibility tree.
- Action icons must remain readable at the smallest Stream Deck key resolution (72×72 px); the icon set already accounts for this.
- Color is not the only cue: state-based title text and icon shape together communicate state (so colorblind users can still tell muted vs. unmuted).

### 8.6 Privacy

- Plugin never transmits any data off the LAN. No telemetry, no analytics.
- No user credentials, no Sonos cloud login, no PII.

---

## 9. Distribution & Packaging Requirements

- Distributed as an Elgato Stream Deck plugin bundle: `com.r-teller.sonoscontroller.streamDeckPlugin`.
- Built and packaged via Elgato's `streamdeck` CLI (`streamdeck pack`). Installable by double-clicking the bundle on macOS or Windows.
- Distribution channel: GitHub Releases (manual download). Not yet on the Elgato Marketplace, but the manifest must be Marketplace-compliant for a future submission.
- Version string follows the pattern `MAJOR.MINOR.PATCH.BUILD`. The CI pipeline injects the GitHub release tag plus build number.
- Supported OS / runtime declared in the manifest:
  - macOS 10.11 or later.
  - Windows 10 or later.
  - Stream Deck application 6.5 or later.
  - Plugin background process: Node.js 20 (debug enabled).
- Manifest also declares: plugin Author, Description, top-level Icon, Category ("Sonos Controller"), CategoryIcon, public-facing URL (the GitHub repo).
- Required icon resolutions in the bundle:
  - Plugin icon: `images/sonos.png` (1×) and `images/sonos@2x.png` (2×).
  - Category icon: `images/category.png` and `images/category@2x.png`.
  - Plugin marketplace card: `images/plugin/plugin.png` and `images/plugin/plugin@2x.png`.
  - Per-action icons: `images/actions/<name>.png` and `images/actions/<name>@2x.png` for all 11 actions (currently_playing, muted, paused, shuffle, input_source, next_track, previous_track, volume_up, volume_down, play_favorite, equalizer; plus mute and unmute variants used internally).
  - Per-state key icons: `images/keys/<state>.png` and `@2x` for every named state (currently_playing, muted, unmuted, mute, unmute, paused, playing, stopped, play_normal, shuffle_no_repeat, shuffle_one, shuffle_on, shuffle_off, repeat_one, repeat_all, repeat_none, input_sonos_queue, input_tv, input_line_in, next_track, previous_track, volume_up, volume_down, play_favorite, equalizer, encoder_paused, encoder_mute, encoder_unmute).
- Three encoder layout JSON files: `layouts/encoder-audio-equalizer.json`, `layouts/encoder-bar-0-100.json`, `layouts/encoder-gbar-10-10.json`.

---

## 10. Asset Requirements

### 10.1 Icon source

All icons are derived from the Material Design icons family (variant: "outlined"). The build pipeline ingests SVGs from the Material Design icons library and rasterizes them with ImageMagick at two scales (1× and 2×).

### 10.2 Icon style

- Action sidebar icons: silver/grey (`#d8d8d8`) on transparent, 20px (1×) / 40px (2×).
- Key (state) icons: black icon on a tan/orange background (`#d8a158`), 72×72 (1×) / 144×144 (2×) with rounded corners (radius 14 / 28). The icon glyph itself is 40px / 80px, centered.
- Category icon: light grey (`#c8c8c8`), 28px / 56px.
- Some key icons are composites (a base icon with a smaller numeral overlay above it): e.g., `repeat_one` = `repeat` icon with `looks_one` overlaid above; `shuffle_one` = `shuffle` + `looks_one`.

### 10.3 Material Design source mappings

| Key icon name | Material Design icon |
|---|---|
| muted | volume_off |
| unmuted | volume_up |
| paused | motion_photos_pause |
| playing | play_circle_filled |
| stopped | stop_circle |
| play_normal | slow_motion_video |
| repeat_all | repeat_on |
| repeat_one | repeat + looks_one (overlay) |
| shuffle_no_repeat | shuffle |
| shuffle_on | shuffle_on |
| shuffle_one | shuffle + looks_one (overlay) |
| input_sonos_queue | queue_music |
| input_line_in | cable |
| input_tv | settings_input_hdmi |
| next_track | skip_next |
| previous_track | skip_previous |
| volume_down | expand_more |
| volume_up | expand_less |
| equalizer | graphic_eq |
| play_favorite | playlist_play |
| currently_playing | spatial_tracking |
| category icon | speaker |

### 10.4 Encoder layouts

Three JSON layouts are required. All conform to Elgato's `layout.json` schema:

1. `encoder-audio-equalizer.json` — minimal placeholder layout with just a 48×48 pixmap icon at (16, 40). Not currently set on the dial in normal flow but bundled with the action.
2. `encoder-bar-0-100.json` — used while the equalizer target is Volume:
   - Title text top, centered, font size 16, weight 600, rect (16,10,136,24).
   - Icon (pixmap), 48×48 at (16,40).
   - Value text right-aligned, font size 24, weight 600, rect (76,40,108,32).
   - Solid bar indicator, range 0–100, subtype 2, no border, rect (76,74,108,12).
3. `encoder-gbar-10-10.json` — used while the equalizer target is Bass or Treble:
   - Same title + icon + value as above.
   - Gradient bipolar bar indicator, range -10..+10, subtype 3, gradient `0:#ff0000, 0.5:yellow, 1:#00ff00`, rect (76,74,108,12), bar height 12.

### 10.5 Plugin-level images

- Speaker silhouette icon for the plugin header, the action category, and the marketplace card (sourced from Material `speaker`, in light grey).

---

## 11. Open Questions & Explicit Non-Goals

### 11.1 Known inconsistencies the rebuild must resolve

- The Toggle Input Source tooltip reads "Toggle input source between line-in, aux and usb." The actual sources cycled are Sonos Queue, TV Input, and Line-In — there is no aux/usb. Rebuild should correct the tooltip to "Toggle input source between Sonos Queue, TV Input, and Line-In."

### 11.2 Explicit non-goals (do not build)

- **No multi-room grouping management.** The plugin does not let users create or modify Sonos zone groups. It operates on the speaker's coordinator implicitly. (Future scope.)
- **No queue management beyond favorites.** Users cannot browse / add / remove tracks from the queue inside the PI. Favorites are the only way to start playback of a specific item.
- **No Sonos cloud or third-party music account browsing.** The PI's favorites list is whatever the user has already starred in the Sonos app; the plugin does not add to it.
- **No SSDP / multicast discovery.** The user must enter one IP. Justification: avoids Stream Deck app firewall prompts and works reliably across VLANs where multicast doesn't traverse.
- **No long-press behavior.** The plugin does not differentiate between short and long key press. Pressing and holding a key does not trigger an alternate action. (`keyUp` is intentionally not consumed.)
- **No dial-press behavior on the Audio Equalizer encoder.** Pressing the dial is a no-op in MVP. Future scope might bind dial press to "switch equalizer target Volume → Bass → Treble".
- **No internationalization.** English only.
- **No Sonos S1 special-casing.** Targets S2 protocol. Older Sonos S1 households may work but are not certified.
- **No persistence of the plugin's runtime cache across restarts.** The discovered devices and favorites lists are persisted via Stream Deck global settings, but the live state cache (current track, current volume) is rebuilt from polling on every plugin start.

### 11.3 Future considerations to scope but not implement

- Stream Deck Marketplace submission with marketplace artwork, screenshots, support URL.
- Speaker grouping picker in the PI (let one action target a Sonos group).
- Queue browser as a paginated PI screen for ad-hoc playback.
- Per-action long-press behavior (e.g., long-press Volume Up = set to a preset level).
- Optional dial-press to swap equalizer target.
