import { reactive } from "vue";

export const actionSettings = reactive({});

export function setActionSettings(context, settings) {
  actionSettings[context] = settings;
}

export function getActionSettings(context) {
  return actionSettings[context];
}

export function deleteActionSettings(context) {
  delete actionSettings[context];
}
