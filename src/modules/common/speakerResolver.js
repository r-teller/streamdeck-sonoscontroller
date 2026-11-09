/**
 * Speaker resolution: decide which physical speaker (uuid + host) a button should talk to.
 *
 * A button stores { uuid, hostAddress, zoneName } from when it was configured. Speakers change IP
 * (DHCP) or get replaced (new uuid), so the stored values are hints. Resolution order:
 *   1. "device"      — the stored uuid is in the discovered household (globalSettings.devices).
 *   2. "replacement" — the user mapped the stored uuid to another speaker (globalSettings.speakerReplacements).
 *   3. "room"        — exactly one non-satellite speaker in the household has the stored zoneName.
 *   4. "saved"       — nothing better known; use the stored values as-is.
 *
 * Pure: no Stream Deck or Vue dependencies, shared by the plugin and the PI.
 */

const MAX_REPLACEMENT_HOPS = 5;

/** @returns {{uuid: string, hostAddress: string, zoneName: string, source: string}} */
function fromDevice(device, source) {
  return { uuid: device.uuid, hostAddress: device.hostAddress, zoneName: device.zoneName, source };
}

/**
 * Follows the replacement map from `uuid` to a speaker present in `devices`.
 * Guards against loops and long chains.
 */
function followReplacements(uuid, devices, replacements) {
  const seen = new Set([uuid]);
  let current = uuid;
  for (let hop = 0; hop < MAX_REPLACEMENT_HOPS; hop++) {
    const next = replacements[current];
    if (!next || seen.has(next)) return null;
    if (devices[next]) return devices[next];
    seen.add(next);
    current = next;
  }
  return null;
}

/**
 * Returns the single non-satellite household speaker in `zoneName`, or null when there is none
 * or more than one (ambiguous rooms are left for the user to resolve explicitly).
 */
export function findRoomSpeaker(zoneName, devices) {
  if (!zoneName) return null;
  const candidates = Object.values(devices ?? {}).filter((d) => d?.zoneName === zoneName && d.isSatellite !== true);
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Resolves a button binding against the current global settings.
 * @param {{uuid?: string, hostAddress?: string, zoneName?: string}} binding
 * @param {{devices?: Object, speakerReplacements?: Object}} [globals]
 * @returns {{uuid: string|undefined, hostAddress: string|undefined, zoneName: string|undefined, source: string}}
 */
export function resolveSpeaker(binding, globals) {
  const uuid = binding?.uuid;
  const devices = globals?.devices ?? {};
  const replacements = globals?.speakerReplacements ?? {};
  const saved = { uuid, hostAddress: binding?.hostAddress, zoneName: binding?.zoneName, source: "saved" };

  if (!uuid) return saved;
  if (devices[uuid]) return fromDevice(devices[uuid], "device");

  const replaced = followReplacements(uuid, devices, replacements);
  if (replaced) return fromDevice(replaced, "replacement");

  const room = findRoomSpeaker(binding?.zoneName, devices);
  if (room) return fromDevice(room, "room");

  return saved;
}

/**
 * True when the household is known (devices discovered) but this binding cannot be resolved to any
 * speaker in it — the "Not found" state shown in the PI.
 */
export function isBindingMissing(binding, globals) {
  const devices = globals?.devices ?? {};
  if (!binding?.uuid || Object.keys(devices).length === 0) return false;
  return resolveSpeaker(binding, globals).source === "saved";
}

/** The display title used for a bound speaker, e.g. "Office (192.168.50.80)". */
export function formatSpeakerTitle(zoneName, hostAddress) {
  return `${zoneName} (${hostAddress})`;
}
