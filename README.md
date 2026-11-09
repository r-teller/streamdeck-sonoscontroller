# Sonos Controller for Stream Deck

Control Sonos speakers directly from your Elgato Stream Deck. Communicates over UPnP/SOAP on your local LAN — no cloud, no Sonos account required. Requires Stream Deck software 6.5+ and macOS 10.11+ or Windows 10+.

## Actions

| Action | Description |
|--------|-------------|
| Currently Playing | Read-only now-playing tile (album art + scrolling title); press forces a state refresh |
| Toggle Mute | Mute/unmute with state icon |
| Toggle Play/Pause | Play/pause/stopped states |
| Toggle Play Mode | Cycles normal/shuffle/repeat modes (configurable subset) |
| Toggle Input Source | Cycles Sonos Queue / TV Input / Line-In (configurable subset) |
| Play Next Track / Play Previous Track | Queue navigation |
| Volume Up / Volume Down | Step volume with configurable increment |
| Play Sonos Favorite | Clears the queue and plays a chosen Sonos favorite |
| Audio Equalizer | Dial (encoder) action: rotate to adjust Volume, Bass, or Treble; LCD bar feedback; touch tap refreshes |

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

Releases are built by CI, which injects `<tag>.<run_number>` into the manifest version (e.g., `0.1.0.123`) and attaches the artifact to the GitHub release.

## License

MIT
