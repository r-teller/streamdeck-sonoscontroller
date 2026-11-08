import { resolveSpeaker, formatSpeakerTitle } from "../common/speakerResolver.js";
import { actionSettings, setActionSettings } from "./actionSettings.js";
import { globalSettings } from "./globalSettings.js";
import { addContext, removeContext, setSpeakerHost } from "./SonosSpeakers.js";

// Runtime-only keys the plugin keeps in actionSettings that must not be written back to Stream Deck.
const RUNTIME_KEYS = ["status", "currentStateIndex"];

function persistable(settings) {
  const out = { ...settings };
  for (const key of RUNTIME_KEYS) delete out[key];
  return out;
}

/**
 * Rewrites on-screen buttons whose stored speaker no longer matches what the resolver finds
 * (IP changed, speaker replaced, room-name match). Only confident resolutions are persisted;
 * "saved" (unresolved) bindings are left untouched.
 *
 * @param {Object} params
 * @param {Object} params.sd - Stream Deck client (needs saveSettings).
 * @param {string[]} [params.contexts] - Limit to these contexts (default: all known).
 * @param {Function} [params.clearDedupeCache] - Called for contexts that moved to another speaker.
 * @returns {string[]} contexts that were rewritten.
 */
export function reconcileBindings({ sd, contexts, clearDedupeCache = () => {} }) {
  const changed = [];
  for (const context of contexts ?? Object.keys(actionSettings)) {
    const current = actionSettings[context];
    if (!current?.uuid) continue;

    const resolved = resolveSpeaker(current, globalSettings);
    if (resolved.source === "saved") continue;
    if (resolved.uuid === current.uuid && resolved.hostAddress === current.hostAddress) continue;

    const next = {
      ...current,
      uuid: resolved.uuid,
      hostAddress: resolved.hostAddress,
      zoneName: resolved.zoneName,
      title: formatSpeakerTitle(resolved.zoneName, resolved.hostAddress),
    };
    setActionSettings(context, next);
    sd?.saveSettings?.({ actionSettings: persistable(next), context });

    if (resolved.uuid !== current.uuid) {
      removeContext({ UUID: current.uuid, context });
      addContext({ UUID: resolved.uuid, context, hostAddress: resolved.hostAddress, zoneName: resolved.zoneName });
      clearDedupeCache(context);
    }
    setSpeakerHost({ UUID: resolved.uuid, hostAddress: resolved.hostAddress });
    changed.push(context);
  }
  return changed;
}

/**
 * Groups on-screen buttons by the speaker they are bound to, for the PI's Speaker Bindings list.
 * @returns {Array<{uuid: string, zoneName: string, hostAddress: string, buttons: number}>}
 */
export function summarizeBindings(settingsMap = actionSettings) {
  const byUuid = new Map();
  for (const s of Object.values(settingsMap)) {
    if (!s?.uuid) continue;
    const entry = byUuid.get(s.uuid) ?? { uuid: s.uuid, zoneName: s.zoneName, hostAddress: s.hostAddress, buttons: 0 };
    entry.buttons += 1;
    byUuid.set(s.uuid, entry);
  }
  return [...byUuid.values()].sort(
    (a, b) =>
      String(a.zoneName).localeCompare(String(b.zoneName)) || String(a.hostAddress).localeCompare(String(b.hostAddress)),
  );
}
