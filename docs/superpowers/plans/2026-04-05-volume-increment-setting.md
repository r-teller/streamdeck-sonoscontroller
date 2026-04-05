# Volume Increment Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a configurable volume increment for Volume Up/Down actions, with a global default and optional per-button override.

**Architecture:** Global `adjustVolumeIncrement` (default `10`) is stored in Stream Deck global settings and threaded through `PluginComponent.vue` to the action handlers. Per-button `adjustVolumeIncrement` is stored in each action's `actionSettings` and takes precedence when set. The PI for volume actions shows an optional override input; the Global Settings accordion shows the default input.

**Tech Stack:** Vue 3, Vite, Stream Deck SDK (`@elgato/streamdeck`), Bootstrap 5

---

## File Map

| File | Change |
|------|--------|
| `public/manifest.json` | Remove hardcoded "by 2" from Volume Up/Down tooltips |
| `src/modules/actions/sonosController.js` | Add `globalAdjustVolumeIncrement` param to `volume_up_action` and `volume_down_action`; update increment resolution |
| `src/components/PluginComponent.vue` | Extract `adjustVolumeIncrement` from global settings; pass to action call site |
| `src/components/PiComponent.vue` | Add global increment setting UI + per-button override UI |

---

### Task 1: Fix manifest tooltips

**Files:**
- Modify: `public/manifest.json`

- [ ] **Step 1: Update Volume Up tooltip**

In `public/manifest.json`, find the Volume Up action (`"UUID": "com.r-teller.sonoscontroller.volume-up"`) and change its `Tooltip`:

```json
"Tooltip": "Increase volume",
```

- [ ] **Step 2: Update Volume Down tooltip**

In the same file, find the Volume Down action (`"UUID": "com.r-teller.sonoscontroller.volume-down"`) and change its `Tooltip`:

```json
"Tooltip": "Decrease volume",
```

- [ ] **Step 3: Commit**

```bash
git add public/manifest.json
git commit -m "fix: remove hardcoded increment value from volume action tooltips"
```

---

### Task 2: Update action handlers to accept global increment

**Files:**
- Modify: `src/modules/actions/sonosController.js`

There is no test suite in this project. Verify changes by building (`npm run build_dev`) and testing manually in Stream Deck.

- [ ] **Step 1: Update `volume_up_action` signature and increment resolution**

Find `volume_up_action` (currently starts around `export async function volume_up_action({`). Update its signature and the line that computes `updatedVolume`:

Old signature:
```js
export async function volume_up_action({ inContext, inActionSettings, inSonosSpeakerState, deviceTimeoutDuration = 1 }) {
```

New signature:
```js
export async function volume_up_action({ inContext, inActionSettings, inSonosSpeakerState, deviceTimeoutDuration = 1, globalAdjustVolumeIncrement = 10 }) {
```

Old increment line (inside the function):
```js
parseInt(inSonosSpeakerState.audioEqualizer.volume) + (parseInt(inActionSettings.adjustVolumeIncrement) || 10),
```

New increment line:
```js
parseInt(inSonosSpeakerState.audioEqualizer.volume) + (parseInt(inActionSettings.adjustVolumeIncrement) || globalAdjustVolumeIncrement),
```

- [ ] **Step 2: Update `volume_down_action` signature and increment resolution**

Find `volume_down_action`. Apply the same changes:

Old signature:
```js
export async function volume_down_action({ inContext, inActionSettings, inSonosSpeakerState, deviceTimeoutDuration = 1 }) {
```

New signature:
```js
export async function volume_down_action({ inContext, inActionSettings, inSonosSpeakerState, deviceTimeoutDuration = 1, globalAdjustVolumeIncrement = 10 }) {
```

Old increment line:
```js
parseInt(inSonosSpeakerState.audioEqualizer.volume) - (parseInt(inActionSettings.adjustVolumeIncrement) || 10),
```

New increment line:
```js
parseInt(inSonosSpeakerState.audioEqualizer.volume) - (parseInt(inActionSettings.adjustVolumeIncrement) || globalAdjustVolumeIncrement),
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/actions/sonosController.js
git commit -m "feat: add globalAdjustVolumeIncrement param to volume up/down actions"
```

---

### Task 3: Thread global increment through PluginComponent

**Files:**
- Modify: `src/components/PluginComponent.vue`

- [ ] **Step 1: Add reactive ref for global increment**

Find the block of `const` refs at the top of `<script setup>` where `deviceTimeoutDuration` and `deviceCheckInterval` are declared:

```js
const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);
```

Add `adjustVolumeIncrement` immediately after:

```js
const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);
const adjustVolumeIncrement = ref(10);
```

- [ ] **Step 2: Read global increment from global settings**

Find the `globalsettings` handler block that reads `deviceCheckInterval` and `deviceTimeoutDuration`:

```js
deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
```

Add the new line immediately after:

```js
deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
adjustVolumeIncrement.value = inGlobalSettings.adjustVolumeIncrement ?? 10;
```

- [ ] **Step 3: Pass global increment to the action call site**

Find the `actionFunction` call inside `PluginComponent.vue` that currently passes `deviceTimeoutDuration`:

```js
const actionResult = await actionFunction({
  inContext,
  inActionSettings: settings,
  inSonosSpeakerState: speaker.state,
  inRotation,
  deviceTimeoutDuration: deviceTimeoutDuration.value,
});
```

Add `globalAdjustVolumeIncrement`:

```js
const actionResult = await actionFunction({
  inContext,
  inActionSettings: settings,
  inSonosSpeakerState: speaker.state,
  inRotation,
  deviceTimeoutDuration: deviceTimeoutDuration.value,
  globalAdjustVolumeIncrement: adjustVolumeIncrement.value,
});
```

- [ ] **Step 4: Commit**

```bash
git add src/components/PluginComponent.vue
git commit -m "feat: thread globalAdjustVolumeIncrement from global settings to action handlers"
```

---

### Task 4: Add global increment setting to PI

**Files:**
- Modify: `src/components/PiComponent.vue`

- [ ] **Step 1: Add the `adjustVolumeIncrement` ref**

Find where `deviceTimeoutDuration` and `deviceCheckInterval` refs are declared in `<script setup>`:

```js
const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);
```

Add immediately after:

```js
const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);
const adjustVolumeIncrement = ref(10);
```

- [ ] **Step 2: Read the value from global settings**

Find the `globalsettings` handler block that reads `deviceCheckInterval` and `deviceTimeoutDuration`:

```js
deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
```

Add immediately after:

```js
deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
adjustVolumeIncrement.value = inGlobalSettings.adjustVolumeIncrement ?? 10;
```

- [ ] **Step 3: Include in `saveGlobalSettings()` payload**

Find the `streamDeckConnection.value.saveGlobalSettings` call inside `saveGlobalSettings()`:

```js
streamDeckConnection.value.saveGlobalSettings({
  payload: {
    devices: getDevices.list,
    deviceCheckInterval: deviceCheckInterval.value,
    deviceTimeoutDuration: deviceTimeoutDuration.value,
    favorites: getFavorites.list,
  },
});
```

Add `adjustVolumeIncrement`:

```js
streamDeckConnection.value.saveGlobalSettings({
  payload: {
    devices: getDevices.list,
    deviceCheckInterval: deviceCheckInterval.value,
    deviceTimeoutDuration: deviceTimeoutDuration.value,
    adjustVolumeIncrement: adjustVolumeIncrement.value,
    favorites: getFavorites.list,
  },
});
```

- [ ] **Step 4: Add the UI input in the Global Settings accordion**

Find the `<div class="mb-3">` inside the Global Settings accordion, which ends after the `deviceCheckInterval` input:

```html
            <input id="deviceCheckInterval" v-model="deviceCheckInterval" class="form-control form-control-sm" type="number" />
          </div>
```

Add the new field immediately before the closing `</div>`:

```html
            <input id="deviceCheckInterval" v-model="deviceCheckInterval" class="form-control form-control-sm" type="number" />
            <label class="form-label" for="adjustVolumeIncrement">Volume Increment (Up/Down)</label>
            <small class="text-muted d-block">Note: Volume range is 0–100. Used by Volume Up and Volume Down actions unless overridden per-button.</small>
            <input
              id="adjustVolumeIncrement"
              v-model.number="adjustVolumeIncrement"
              class="form-control form-control-sm"
              type="number"
              min="1"
            />
          </div>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/PiComponent.vue
git commit -m "feat: add global volume increment setting to PI global settings"
```

---

### Task 5: Add per-button override to PI

**Files:**
- Modify: `src/components/PiComponent.vue`

- [ ] **Step 1: Add refs for the per-button override**

Find the `isEncoderAudioEqualizer` ref declaration block:

```js
const isEncoderAudioEqualizer = ref(false);
const availableEqualizerTargets = ref(["volume", "bass", "treble"]);
const encoderAudioEqualizerTarget = ref("");
```

Add new refs immediately after:

```js
const isEncoderAudioEqualizer = ref(false);
const availableEqualizerTargets = ref(["volume", "bass", "treble"]);
const encoderAudioEqualizerTarget = ref("");

const isVolumeAction = ref(false);
const perButtonAdjustVolumeIncrement = ref(null);
```

- [ ] **Step 2: Handle `volume-up` and `volume-down` in the `globalsettings` switch**

Find the `switch (actionName.value)` block inside the `globalsettings` handler. Add a new case after the existing `encoder-audio-equalizer` case:

```js
case "encoder-audio-equalizer":
  isEncoderAudioEqualizer.value = true;
  if (actionSettings.value?.encoderAudioEqualizerTarget) {
    encoderAudioEqualizerTarget.value = actionSettings.value.encoderAudioEqualizerTarget;
  } else {
    encoderAudioEqualizerTarget.value = "VOLUME";
  }
  break;
case "volume-up":
case "volume-down":
  isVolumeAction.value = true;
  perButtonAdjustVolumeIncrement.value = actionSettings.value?.adjustVolumeIncrement ?? null;
  break;
```

- [ ] **Step 3: Include override in `saveSettings()`**

Find the `actionSettings.value = { ... }` block in `saveSettings()`. Add the per-button override field. Find the closing of the object — after the last field before `};` — and add:

```js
adjustVolumeIncrement: perButtonAdjustVolumeIncrement.value || null,
```

For example, if the last line before `};` is:

```js
    selectedSonosFavorite: selectedSonosFavorite.value
      ? { ... }
      : null,
  };
```

Add the new field before the closing `};`:

```js
    selectedSonosFavorite: selectedSonosFavorite.value
      ? { ... }
      : null,
    adjustVolumeIncrement: perButtonAdjustVolumeIncrement.value || null,
  };
```

(`|| null` ensures an empty input (`""`) or `0` is saved as `null`, meaning "use global".)

- [ ] **Step 4: Add per-button override UI section in template**

Find the encoder equalizer target section in the template:

```html
    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isEncoderAudioEqualizer">
```

Add a new section immediately before it:

```html
    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isVolumeAction">
      <h1>Volume Increment</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <label class="form-label" for="perButtonAdjustVolumeIncrement">Override increment (leave empty to use global default)</label>
        <small class="text-muted d-block">Volume range: 0–100</small>
        <input
          id="perButtonAdjustVolumeIncrement"
          v-model.number="perButtonAdjustVolumeIncrement"
          class="form-control form-control-sm"
          type="number"
          min="1"
          :placeholder="`Global default: ${adjustVolumeIncrement}`"
          @change="saveSettings"
        />
      </div>
    </div>

    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isEncoderAudioEqualizer">
```

- [ ] **Step 5: Commit**

```bash
git add src/components/PiComponent.vue
git commit -m "feat: add per-button volume increment override to PI"
```

---

### Task 6: Build and verify

**Files:** none

- [ ] **Step 1: Build**

```bash
npm run build_dev
```

Expected: build completes with no errors. Warnings about unused variables are OK; errors are not.

- [ ] **Step 2: Manual verification checklist**

Install the plugin in Stream Deck (open the built `.sdPlugin` folder or use `npm run package`). Verify:

1. Open Global Settings for any action → the "Volume Increment (Up/Down)" field appears, defaults to 10, and saves (reconnect reloads it correctly)
2. Open a Volume Up button's PI → a "Volume Increment" override field appears with a placeholder showing the global default
3. Leave the override empty → pressing the button increments volume by the global default
4. Set the override to `5` → pressing the button increments by 5 regardless of global setting
5. Set a different global default (e.g. `3`) → buttons without a per-button override now increment by 3; buttons with an override continue to use their own value
6. Volume Down mirrors all of the above

- [ ] **Step 3: Final commit if any fixups were made**

```bash
git add -p   # stage only intentional changes
git commit -m "fix: <description of any fixups>"
```
