# Sonos Controller for Stream Deck

Control Sonos speakers directly from your Elgato Stream Deck. Communicates over UPnP/SOAP on your local LAN — no cloud, no Sonos account required. Requires Stream Deck software 6.5+ and macOS 10.11+ or Windows 10+.

## Actions

Every action is bound to one speaker, chosen in the action's settings. Keys work on any Stream
Deck; dials need a Stream Deck +. **Icon** is what you drag from the action list in the Stream
Deck app; **States** are the images the key can show.

### Keys

| Icon | Key | States | Press | Shows | Settings |
|---|---|---|---|---|---|
| <img src="docs/images/action-icons/currently_playing.png" width="32" alt="Currently Playing" title="Currently Playing"> | Currently Playing | <img src="public/images/keys/currently_playing@2x.png" width="40" alt="currently playing" title="currently playing"> | Refreshes the speaker's state | Album art with a scrolling title | Album art, scrolling title |
| <img src="docs/images/action-icons/paused.png" width="32" alt="Toggle Play/Pause" title="Toggle Play/Pause"> | Toggle Play/Pause | <img src="public/images/keys/paused@2x.png" width="40" alt="paused" title="paused"> <img src="public/images/keys/playing@2x.png" width="40" alt="playing" title="playing"> <img src="public/images/keys/stopped@2x.png" width="40" alt="stopped" title="stopped"> | Play or pause | Paused, playing or stopped; album art if enabled | Album art, scrolling album title, state title |
| <img src="docs/images/action-icons/muted.png" width="32" alt="Toggle Mute" title="Toggle Mute"> | Toggle Mute | <img src="public/images/keys/unmuted@2x.png" width="40" alt="unmuted" title="unmuted"> <img src="public/images/keys/muted@2x.png" width="40" alt="muted" title="muted"> | Mute or unmute | Unmuted or muted | State title |
| <img src="docs/images/action-icons/shuffle.png" width="32" alt="Toggle Play Mode" title="Toggle Play Mode"> | Toggle Play Mode | <img src="public/images/keys/play_normal@2x.png" width="40" alt="play normal" title="play normal"> <img src="public/images/keys/shuffle_no_repeat@2x.png" width="40" alt="shuffle no repeat" title="shuffle no repeat"> <img src="public/images/keys/shuffle_one@2x.png" width="40" alt="shuffle one" title="shuffle one"> <img src="public/images/keys/shuffle_on@2x.png" width="40" alt="shuffle on" title="shuffle on"> <img src="public/images/keys/repeat_one@2x.png" width="40" alt="repeat one" title="repeat one"> <img src="public/images/keys/repeat_all@2x.png" width="40" alt="repeat all" title="repeat all"> | Next shuffle/repeat mode | Normal, shuffle (no repeat), shuffle (repeat one), shuffle (repeat all), repeat one, repeat all | Which modes to cycle through |
| <img src="docs/images/action-icons/input_source.png" width="32" alt="Toggle Input Source" title="Toggle Input Source"> | Toggle Input Source | <img src="public/images/keys/input_sonos_queue@2x.png" width="40" alt="input sonos queue" title="input sonos queue"> <img src="public/images/keys/input_tv@2x.png" width="40" alt="input tv" title="input tv"> <img src="public/images/keys/input_line_in@2x.png" width="40" alt="input line in" title="input line in"> | Next source | Sonos Queue, TV or Line-In | Which sources to cycle through |
| <img src="docs/images/action-icons/previous_track.png" width="32" alt="Play Previous Track" title="Play Previous Track"> | Play Previous Track | <img src="public/images/keys/previous_track@2x.png" width="40" alt="previous track" title="previous track"> | Previous track in the queue |  |  |
| <img src="docs/images/action-icons/next_track.png" width="32" alt="Play Next Track" title="Play Next Track"> | Play Next Track | <img src="public/images/keys/next_track@2x.png" width="40" alt="next track" title="next track"> | Next track in the queue |  |  |
| <img src="docs/images/action-icons/volume_down.png" width="32" alt="Volume Down" title="Volume Down"> | Volume Down | <img src="public/images/keys/volume_down@2x.png" width="40" alt="volume down" title="volume down"> | Lowers the volume |  | Volume step |
| <img src="docs/images/action-icons/volume_up.png" width="32" alt="Volume Up" title="Volume Up"> | Volume Up | <img src="public/images/keys/volume_up@2x.png" width="40" alt="volume up" title="volume up"> | Raises the volume |  | Volume step |
| <img src="docs/images/action-icons/play_favorite.png" width="32" alt="Play Sonos Favorite" title="Play Sonos Favorite"> | Play Sonos Favorite | <img src="public/images/keys/play_favorite@2x.png" width="40" alt="play favorite" title="play favorite"> | Clears the queue and plays the chosen favorite |  | Favorite |

### Dials (Stream Deck +)

Each dial draws on its part of the touch strip.

| Icon | Dial | Turn | Push | Tap the strip | Settings |
|---|---|---|---|---|---|
| <img src="docs/images/action-icons/equalizer.png" width="32" alt="Audio Equalizer" title="Audio Equalizer"> | Audio Equalizer | Adjusts Volume, Bass or Treble | Mute, play/pause, next track or nothing | Re-reads volume, bass and treble | Which level to adjust; what push does |
| <img src="docs/images/action-icons/shuffle.png" width="32" alt="Play Mode Dial" title="Play Mode Dial"> | Play Mode Dial | Slides through the shuffle/repeat modes; applied when you stop turning | Next mode now | Next mode now | Which modes appear |
| <img src="docs/images/action-icons/currently_playing.png" width="32" alt="Queue Track Dial" title="Queue Track Dial"> | Queue Track Dial | Slides through the current queue (art, title, artist, position); plays the track when you stop turning; wraps at both ends | Next track now | Next track now | |

On the touch strip (the Queue Track Dial shows **Not playing from queue** and does nothing while
the speaker plays radio, TV or line-in):

<table>
  <tr>
    <td align="center"><img src="docs/images/dial-audio-equalizer.png" width="200" alt="Audio Equalizer: Volume 45 with a level bar"><br>Audio Equalizer</td>
    <td align="center"><img src="docs/images/dial-play-mode.png" width="200" alt="Play Mode Dial: carousel of modes"><br>Play Mode Dial</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/dial-queue-track.png" width="200" alt="Queue Track Dial: carousel of queue tracks"><br>Queue Track Dial</td>
    <td align="center"><img src="docs/images/dial-queue-track-not-on-queue.png" width="200" alt="Queue Track Dial: Not playing from queue"><br>Queue Track Dial, not on the queue</td>
  </tr>
</table>

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
