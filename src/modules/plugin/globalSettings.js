import { reactive } from "vue";

export const globalSettings = reactive({});

export function setGlobalSettings(blob) {
  for (const key of Object.keys(globalSettings)) {
    delete globalSettings[key];
  }
  Object.assign(globalSettings, blob ?? {});
}

export function getGlobalSettings() {
  return globalSettings;
}
