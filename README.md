# Sonos Controller for Stream Deck

Control Sonos speakers directly from your Elgato Stream Deck. Communicates over UPnP/SOAP on your local LAN — no cloud, no Sonos account required. Requires Stream Deck software 6.5+ and macOS 10.11+ or Windows 10+.

## Actions

Every action is bound to one speaker, chosen in the action's settings. Keys work on any Stream
Deck; dials need a Stream Deck +.

### Keys

| | Key | Press | Shows | Settings |
|---|---|---|---|---|
| <img src="public/images/keys/currently_playing@2x.png" width="40" alt=""> | Currently Playing | Refreshes the speaker's state | Album art and a scrolling title | Album art, scrolling title |
| <img src="public/images/keys/playing@2x.png" width="40" alt=""> <img src="public/images/keys/paused@2x.png" width="40" alt=""> | Toggle Play/Pause | Play or pause | Playing, paused or stopped; optional album art | Album art, scrolling album title, state title |
| <img src="public/images/keys/unmuted@2x.png" width="40" alt=""> <img src="public/images/keys/muted@2x.png" width="40" alt=""> | Toggle Mute | Mute or unmute | Muted or unmuted | State title |
| <img src="public/images/keys/play_normal@2x.png" width="40" alt=""> <img src="public/images/keys/shuffle_on@2x.png" width="40" alt=""> <img src="public/images/keys/repeat_all@2x.png" width="40" alt=""> | Toggle Play Mode | Next shuffle/repeat mode | The current mode | Which modes to cycle through |
| <img src="public/images/keys/input_sonos_queue@2x.png" width="40" alt=""> <img src="public/images/keys/input_tv@2x.png" width="40" alt=""> <img src="public/images/keys/input_line_in@2x.png" width="40" alt=""> | Toggle Input Source | Next source: Sonos Queue, TV, Line-In | The current source | Which sources to cycle through |
| <img src="public/images/keys/previous_track@2x.png" width="40" alt=""> <img src="public/images/keys/next_track@2x.png" width="40" alt=""> | Play Previous / Next Track | Previous or next track in the queue | | |
| <img src="public/images/keys/volume_down@2x.png" width="40" alt=""> <img src="public/images/keys/volume_up@2x.png" width="40" alt=""> | Volume Down / Up | Lowers or raises the volume | | Volume step |
| <img src="public/images/keys/play_favorite@2x.png" width="40" alt=""> | Play Sonos Favorite | Clears the queue and plays the chosen favorite | | Favorite |

### Dials (Stream Deck +)

Each dial draws on its part of the touch strip.

#### Audio Equalizer

<img src="docs/images/dial-audio-equalizer.png" width="300" alt="Audio Equalizer dial showing Volume 45 with a level bar">

- **Turn:** adjusts Volume, Bass or Treble (chosen in settings); the bar shows the level.
- **Push:** mute, play/pause, next track or nothing (chosen in settings).
- **Tap the strip:** re-reads volume, bass and treble from the speaker.

#### Play Mode Dial

<img src="docs/images/dial-play-mode.png" width="300" alt="Play Mode dial: a carousel of mode cards with Shuffle No Repeat in the centre">

- **Turn:** slides a carousel of shuffle/repeat modes; the mode is applied when you stop turning.
- **Push or tap:** switches to the next mode right away.
- **Settings:** which modes appear in the carousel.

#### Queue Track Dial

<img src="docs/images/dial-queue-track.png" width="300" alt="Queue Track dial: a carousel of queue tracks with Track Three, 3 of 5, in the centre">

- **Turn:** slides through the tracks in the current queue (album art, title, artist and
  position); the track plays when you stop turning. Wraps from the last track to the first.
- **Push or tap:** plays the next track right away.
- When the speaker is playing radio, TV or line-in, the dial shows **Not playing from queue**
  and does nothing:

  <img src="docs/images/dial-queue-track-not-on-queue.png" width="300" alt="Queue Track dial showing Not playing from queue">

## First-run setup

1. Install the plugin by double-clicking the `.streamDeckPlugin` file from a GitHub Release.
2. Drag any Sonos action onto a key on your Stream Deck.
3. The plugin prompt appears: enter your **Primary Device Address (Discovery)** — e.g., `192.168.1.42` (the IP of any Sonos speaker on your network; find it in the Sonos app under Settings → System → About My System).
4. Tap **Save and Connect**. Your household is discovered, the speaker dropdown populates, and the discovery speaker becomes the default bind for new actions.

## Local development

1. Clone the repo: `git clone https://github.com/r-teller/streamdeck-sonoscontroller.git`
2. Install dependencies: `npm install`
3. Build and validate: `npm run build_dev_incr && npm run validate`
4. Side-load the plugin:
   - macOS: `ln -s "$(pwd)/com.r-teller.sonoscontroller.sdPlugin" ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/com.r-teller.sonoscontroller.sdPlugin`
   - Windows: `mklink /J "%APPDATA%\Elgato\StreamDeck\Plugins\com.r-teller.sonoscontroller.sdPlugin" "%CD%\com.r-teller.sonoscontroller.sdPlugin"`
   - Or use `streamdeck link` if `@elgato/cli` is globally installed.
5. Restart the Stream Deck app to reload the plugin.  
   Note: There is no hot reload — rebuild and restart to pick up changes. The manifest enables Node.js debugging for the plugin background; the PI webview has its own devtools via the Stream Deck app’s debug mode.

## Testing

- `npm test` runs the Vitest unit suite.
- `npm run test:pw` runs Playwright end-to-end scenarios against a mocked Stream Deck host and mocked Sonos household (`tests/playwright/support/mockStreamDeckHost.js`, `mockSonos.js`) with committed screenshot baselines under `tests/playwright/screenshots/`. Run `npm run build_dev` before `test:pw`.
- Lint and format checks: `npm run lint` and `npm run format:check`.

## Packaging

Build and package locally with:  
`npm run build && npm run package`  
This produces `com.r-teller.sonoscontroller.streamDeckPlugin` in the repo root.

Releases are built by CI when a GitHub release is published; it stamps the version from the tag and attaches the plugin file. See [docs/releases.md](docs/releases.md) for version numbers (betas `x.y.z.n`, final `x.y.z`) and steps.

## License

MIT
