# Volume Increment Setting — Design

## Overview

Expose the volume increment for the Volume Up and Volume Down actions as a configurable setting. A global default applies to all volume buttons; individual buttons can override it.

## Requirements

- Global default increment: `10` (min: `1`, no enforced max)
- Per-button override: optional; absent means "use global"
- Volume range hint displayed in UI: "Volume range: 0–100"
- Fix manifest tooltips: "by 2" → "by 10"

## Architecture

### Global settings (`PiComponent.vue` + `PluginComponent.vue`)

Add `adjustVolumeIncrement` to the global settings payload:

- **PI (`PiComponent.vue`):** Add a number input in the Global Settings accordion, below the existing timeout/interval inputs. Label: "Volume Increment (Up/Down)". Helper text: "Volume range: 0–100". Min: 1.
- **`saveGlobalSettings()`:** Include `adjustVolumeIncrement` in the payload saved via `streamDeckConnection.value.saveGlobalSettings()`.
- **`PluginComponent.vue`:** On `globalsettings`, extract `inGlobalSettings.adjustVolumeIncrement` (defaulting to `10`) into a reactive ref `adjustVolumeIncrement`, mirroring the existing `deviceTimeoutDuration` pattern.

### Per-button settings (`PiComponent.vue`)

For `actionName === 'volume-up'` and `actionName === 'volume-down'`, show an action-specific section with a number input for `adjustVolumeIncrement`. Label: "Volume Increment". Helper: "Volume range: 0–100. Leave blank to use the global default." Min: 1. The field is optional — only written to `actionSettings` when the user provides a value; absent/null means inherit from global.

The `saveSettings()` function already writes all `actionSettings` fields unconditionally. The per-button `adjustVolumeIncrement` should only be included when the user has set a value (i.e. the ref is non-null/non-empty).

### Action handlers (`src/modules/actions/sonosController.js`)

Add `globalAdjustVolumeIncrement` as a named parameter to `volume_up_action` and `volume_down_action`. Resolution:

```js
const increment = parseInt(inActionSettings.adjustVolumeIncrement) || globalAdjustVolumeIncrement;
```

Remove the existing `|| 10` fallback — the global value is always present.

### Passing global value to actions (`PluginComponent.vue`)

Where action handlers are called, pass `globalAdjustVolumeIncrement: adjustVolumeIncrement.value` alongside the existing `deviceTimeoutDuration`, mirroring that pattern exactly.

## Manifest fix

In `public/manifest.json`, update:
- Volume Up `Tooltip`: `"Increase volume by 2"` → `"Increase volume by 10"`
- Volume Down `Tooltip`: `"Decrease volume by 2"` → `"Decrease volume by 10"`
