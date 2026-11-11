# Adding or changing a Stream Deck action (keys and dials)

An action is not done until every interaction it handles is tested at both the unit and the
Playwright level. This applies to new actions and to new behaviour on existing ones.

## Before coding

The beads issue lists acceptance criteria for each interaction the action handles:

- `willAppear`: layout (dials) and the initial value shown
- `dialRotate`: +1, -1, a fast burst, and the min/max limits (or wrap-around, for dials
  that step through a list)
- `dialDown` (push), `touchTap`, `keyDown`
- what happens when the speaker returns an error
- any settings the action adds to the property inspector (PI)

`bd create` warns when acceptance criteria are missing (`validation.on-create: warn`).

## Unit tests (Vitest, `tests/unit/`)

- Every handler the action registers in `actionFunctionMap` (`dialRotate`, `dialDown`,
  `touchTap`, `keyDown`, `state`) has a test for its result and the Sonos call it makes.

## Playwright (`tests/playwright/`)

- Drive the real plugin through the mock Stream Deck host
  (`tests/playwright/support/mockStreamDeckHost.js`): `willAppear` with controller
  `"Encoder"` for dials, then every event the action handles. Never call action functions
  directly from a Playwright test.
- Assert both sides:
  - the Sonos request, from `mock.calls` (action name and value sent), and
  - the frames sent to Stream Deck (`setFeedbackLayout`, `setFeedback` values,
    `setTitle`, `setImage`, `setState`).
- A burst of `dialRotate` events sends exactly one `Set*` call with the summed value.
- Turning past a limit stops at the limit; check the value actually sent.
- Dials that step through a list (play modes, queue tracks) wrap instead: a burst moves by
  the net steps modulo the list length; test both ends, and test a burst that cancels out
  (e.g. +1 -1) or a full lap: it must send nothing and show no alert.
- Carousel dials (`carousel: true`, see `src/modules/plugin/carousel.js`) move the
  selection on every tick and apply it once turning stops (`dialSettleMs`). Test that the
  caption changes before any Sonos call, that nothing is sent until the settle time, and
  then exactly one call.
- After a change, wait for the next poll and check the value sticks, with
  `waitForPollAfter(page, mock, { set, get })` from `tests/playwright/support/polling.js`
  (it waits for a `get` poll issued after the `set` call, then lets the render finish).
  The fake speaker
  (`tests/playwright/support/mockSonos.js`) remembers, per speaker, the last volume, bass,
  treble, mute, play mode, play/pause/stop and queue position (`Seek` by `TRACK_NR`) the
  plugin set, and reports it on the next poll. A fixture swapped in mid-test with `setActionFixture` overrides the remembered value.
- Push a dial with `mockHost.inject.dialDown(ctx)`; it sends dialDown then dialUp, like a
  real push.
- A speaker failure (`installMockSonos(page, { failures })` or `mock.setFailure`) shows the
  error state and produces no page errors. Use at most 3 failing gestures per test: after
  more than 3 failed attempts in 10 s the rate limiter drops input silently (sonos-70r).
  Filter the browser's own "Failed to load resource" logs for injected HTTP errors.
- Save screenshot baselines of the dial or key face through `harness/key-preview.html`
  as `tests/playwright/screenshots/<spec>-<action>-<state>.png`. Look at them before
  committing. Do not commit existing screenshots that changed only by render noise
  (marquee position, anti-aliasing); restore them with `git checkout`.
- Prove each new test once: it must fail with the feature removed and pass with it.

`tests/unit/actionCoverage.test.js` enforces part of this in CI: every dial action in
`public/manifest.json` must be driven by a Playwright spec for each event it registers. It
reads the spec source, so keep `willAppear(ctx, <action>, settings, "Encoder")` and the
`inject.<event>(` calls in the test body, not in a shared helper. It only proves each event
is sent; the assertions on its effect are still up to you.

## Lists to update for a new action

These are kept by hand; update them in the same change:

- `public/manifest.json`: the action, its `Controllers`, and for dials `Encoder.layout`
  and `TriggerDescription`
- `ACTION_NAMES` in `src/modules/plugin/actionDispatcher.js`
- the action count in `tests/unit/packageIntegrity.test.js`
- PI sections and schema gates in `src/modules/pi/actionSettingsSchema.js` (e.g.
  `PLAY_MODE_ACTIONS`) and `tests/unit/PiComponent.actionSections.test.js`
- `tests/playwright/p4.spec.js` per-action PI matrix, if the action has PI settings

The screenshot preview reads layouts from `public/layouts/*.json` directly, so a new
layout needs no harness change.

## Before merge

- CI passes: `format:check`, `lint`, `npm test`, `build`, `validate`, Playwright.
- Hands-on check on a real Stream Deck + (deploy steps: `bd memories stream-deck`).
  Playwright cannot judge these; check them on the device:
  - how a layout looks: font width (the preview uses the browser's fonts), text cut at the
    item edge, pixmap images (plugin-relative paths, @2x files) and `showAlert` on the strip
  - how a dial feels: settle and debounce times, slide animation speed
  - the `TriggerDescription` texts in the Stream Deck app
