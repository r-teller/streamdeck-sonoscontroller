# Adding or changing a Stream Deck action (keys and dials)

An action is not done until every interaction it handles is tested at both the unit and the
Playwright level. This applies to new actions and to new behaviour on existing ones.

## Before coding

The beads issue lists acceptance criteria for each interaction the action handles:

- `willAppear`: layout (dials) and the initial value shown
- `dialRotate`: +1, -1, a fast burst, and the min/max limits
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
- After a change, wait for the next poll and check the value sticks. The fake speaker
  (`tests/playwright/support/mockSonos.js`) must remember the value (sonos-8px.2).
- A speaker failure (`installMockSonos(page, { failures })`) shows the error state and
  produces no page errors.
- Save screenshot baselines of the dial or key face through `harness/key-preview.html`
  as `tests/playwright/screenshots/<spec>-<action>-<state>.png`. Look at them before
  committing. Do not commit existing screenshots that changed only by render noise
  (marquee position, anti-aliasing); restore them with `git checkout`.
- Prove each new test once: it must fail with the feature removed and pass with it.

`tests/unit/actionCoverage.test.js` enforces part of this in CI: every dial action in
`public/manifest.json` must be driven by a Playwright spec for each event it registers.

## Before merge

- CI passes: `format:check`, `lint`, `npm test`, `build`, `validate`, Playwright.
- A new dial layout is also added to `LAYOUTS` in `harness/preview.js`, otherwise the
  screenshots cannot draw it.
- Hands-on check on a real Stream Deck + (deploy steps: `bd memories stream-deck`).
  Playwright cannot judge how a dial feels or how a layout looks on the device.
