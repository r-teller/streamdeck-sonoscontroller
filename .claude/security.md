# Security Blueprint

Purpose: Establishes security rules and best practices for a LAN-only Stream Deck plugin that talks unauthenticated SOAP to Sonos speakers on port 1400. The threat model is small but specific — the plugin transmits no data off the LAN, has no users, no accounts, no PII — but it does run inside a third-party host (the Stream Deck app) and bundles supply-chain dependencies.

---

## 0. Baseline Best Practices

- **Never Hardcode Secrets:** There are no secrets in this project. Don't introduce any. The plugin needs no API keys, no Sonos OAuth tokens, no analytics keys.
- **Use a `.gitignore` file:** `.gitignore` includes the build output (`com.r-teller.sonos*`) and `node_modules`. There are no `.env` files in this project — if one is ever added, it must be git-ignored before being committed.
- **Use Environment Variables (when needed):** Currently not needed. If future build tooling adds secrets (e.g., a code-signing certificate password for a Marketplace submission), load via the CI runner's secret store, never via committed files.
- **Apply the Principle of Least Privilege:** The plugin makes only the SOAP calls listed in `backend.md` to port 1400. It must not open any other ports, talk to any other host, or escalate beyond what's needed for transport/render.

---

## 1. Data Sensitivity Level

**My Project's Data is: Internal (LAN-only).**

The plugin reads zone topology, transport state, mute/volume/bass/treble, current track metadata (title, artist, album, album-art URL), and Sonos favorites from the user's own speakers on the user's own LAN. It writes back transport commands (Play, Pause, SetMute, SetVolume, SetAVTransportURI, etc.). It does **not** transmit any of this data off the LAN. There are no user accounts, no PII, no telemetry, no analytics, no cloud component.

Track titles and album art may be considered sensitive by some users (someone may not want their roommate to see what's playing on a key face). Mitigation: the user controls placement — they choose whether to drop a "Currently Playing" tile, and they can disable `Display Marquee Title` / `Display Album Art` toggles per-action.

---

## 2. Authentication & Authorization

**Authentication Method: None.**

Sonos's local API on port 1400 is unauthenticated for clients on the same LAN. There is no Sonos OAuth, no household pairing, no username/password. The plugin has no concept of a "user" — whoever installs it on the host machine has full transport/volume control over every speaker on that LAN.

**Authorization Rules: N/A.** Anyone with a Stream Deck and the plugin installed can control every Sonos on their network.

### Threat model

| Threat | Risk | Mitigation |
|---|---|---|
| Hostile process on the same LAN issues SOAP commands directly to port 1400 | Already possible with or without this plugin — Sonos itself does not authenticate | Out of scope. Document as a Sonos network-architecture choice, not a plugin defect. |
| Hostile JS in `pi.html` exfiltrates discovered IPs/track titles | The PI runs the same code as the plugin and fetches album art over plain HTTP | Don't render album-art URLs sourced from outside Sonos; treat the album-art URL as a same-LAN HTTP fetch and ignore failures silently |
| Hostile XML in a SOAP response causes XXE / parser injection | `DOMParser` is used to parse responses; `convertXmlToJson` walks the DOM | Use `DOMParser` with default settings (no external entity loading in browsers); never `eval` response content; never interpolate response text into HTML without escaping |
| Plugin manifest claims wider OS / SDK access than needed | Stream Deck's plugin model does not currently sandbox plugins meaningfully | Keep manifest narrow — only request `Keypad` and `Encoder` controllers as needed per action |
| User enters a non-Sonos IP (typo or malicious) | Plugin will issue SOAP requests to that IP | Time out the request (default 10 s). Show actionable error. Don't retry indefinitely. |

---

## 3. Dependency & Supply Chain Security

**How We Check Dependencies: GitHub Dependabot + `npm audit` before release.** Every `npm install` should be run against a clean lockfile. The release workflow (`releases.yml`) currently does not run `npm audit` — the rebuild should add it as a non-blocking advisory step (security-only, ignore informational findings).

**Rule for Adding New Dependencies: Justify in a PR description.** Every new dependency must answer: (1) what does it do that we can't write in 50 lines, (2) is it actively maintained, (3) does it bring transitive deps that bloat the bundle, (4) does it run in the plugin background or only at build time?

### Vestigial dependencies the rebuild should drop

The existing repo carries dependencies that are installed but never imported by production code. These inflate `node_modules` and the supply-chain attack surface for no benefit:

- `axios` — `fetch` is used everywhere; remove
- `sonos` — Node `sonos` package is not imported; SOAP is hand-rolled; remove
- `js-yaml`, `nunjucks`, `snapsvg-cjs` — vestigial; remove
- `fs` (the npm placeholder package) — added by mistake; remove
- `core-js` — likely transitive; verify and remove if unused
- `@mdi/font`, `@mdi/js` — icons come from the `material-design-icons` git submodule, not these npm packages; remove

### Build-time vs runtime separation

- **Build-time only:** `vite`, `@vitejs/plugin-vue`, `@elgato/cli`, `eslint*`, `prettier`, `rollup`, `sass`, `shx`. These never enter the shipped bundle.
- **Runtime (shipped to user):** anything imported by `plugin.html` or `pi.html`. Currently: `vue`, `bootstrap`, `@popperjs/core`, `buffer`, `@elgato/streamdeck` (only `EventEmitter`). Keep this list minimal.

### CI hygiene

Three CI workflow files (`main.yml`, `brainch.yml`, `releases.yml`) currently use deprecated action versions (`actions/checkout@v2`, `actions/setup-node@v2.1.4`, `actions/upload-release-asset@v1`). The rebuild should bring them current to receive ongoing security fixes. `brainch.yml` also has a path-filter typo (`public.html` instead of `plugin.html`) that should be fixed so branch CI re-runs when `plugin.html` changes.

---

## 4. Secrets Management & Best Practices

**Where Secrets are Stored: Nowhere. There are no secrets.**

The plugin does not need API keys, Sonos credentials, or external service tokens. The only "secret-shaped" piece of data is the user's primary Sonos device IP (e.g., `192.168.1.42`), which is persisted via the Stream Deck app's `setGlobalSettings` JSON blob. That blob lives in the Stream Deck app's local plugin storage on the user's machine — it never leaves the LAN.

**Who Has Access to Secrets: N/A.**

If the project ever publishes to the Elgato Marketplace, the submission may require a code-signing certificate. At that point:
- Store the cert in the CI runner's secret store (GitHub Actions encrypted secrets).
- Never commit the cert or its password.
- Restrict access to the secret to the release workflow only.

---

## 5. Privacy Commitments

These are user-facing promises the rebuild must honor:

- **Plugin never transmits any data off the LAN.** No telemetry. No analytics. No "phone home". No update checks beyond what the Stream Deck application itself does.
- **No user credentials, no Sonos cloud login, no PII.** The plugin has no concept of users.
- **No persistent log of user activity.** Errors are written to the Stream Deck plugin log (a local file the user can inspect or delete).
- **Album art and track metadata are fetched only from Sonos itself or from URLs Sonos provides.** The plugin does not fetch from third-party metadata services.

If any of these change in a future version, it must be a documented change in the README and an opt-in for existing users — never a silent default.

---

## 6. Error-message hygiene

User-visible exception messages must carry actionable causes — never raw programmer artifacts. Wrap raw exceptions and translate them at the boundary before showing them to the user:

| ❌ Bad | ✓ Good |
|---|---|
| `u is not iterable` | `Failed to get devices: response missing ZoneGroups (single-zone household with malformed XML?)` |
| `Cannot read property 'x' of undefined` | `Could not parse Sonos response from 192.168.1.42:1400 — unexpected payload` |
| `fetch failed` | `Could not reach 192.168.1.42:1400 (timeout after 10 seconds)` |
| `groups is not iterable` | `Failed to get devices: discovery response was malformed` |

This is both a UX and a security measure — leaking stack traces or library internals into user-visible error toasts gives attackers free reconnaissance about the codebase.
