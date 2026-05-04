// Coordinator resolution for the Sonos integration layer.
//
// Spike output for `cel`. Promoted to production by `h75.6` (per-action SOAP
// commands), which wires this resolver into Play / Pause / Next / Prev /
// SetAVTransportURI / queue ops so transport calls always target the
// coordinator of the bound speaker's group, never the speaker itself.
//
// Why this matters: prd-what.md §11 marks "no group management" as a
// non-goal — the plugin never creates, dissolves, or modifies Sonos groups —
// but Sonos rejects transport commands issued against a non-coordinator
// member with `701 Transition not available`. So every transport call has to
// READ the topology, find the group containing the bound speaker, and
// extract that group's `Coordinator` attribute. This module is that read.
//
// The walk reuses the same shape as `getDevices()` (sonosController.js:99) —
// `ZoneGroups.ZoneGroup[] → ZoneGroupMember[] → Satellite[]` — so reviewers
// don't have to re-learn the topology. `asArray` at every iteration site is
// the discipline that prevents the prd-what.md §3.3 "is not iterable"
// regression on single-element households (one group, one member, one
// satellite all collapse to objects, not one-element arrays).
//
// See `.archive/plans/2026-05-03-coordinator-resolution.md` for the spike
// findings (Q1–Q5), edge-case contracts, and worked traces.

import { asArray } from "@/modules/common/xml.js";
import { SonosError } from "@/modules/common/sonosErrors.js";

/**
 * Resolve the coordinator UUID for the group containing the bound speaker.
 *
 * Walks the parsed `ZoneGroupTopology` JSON (the output of
 * `convertXmlToJson` over the `ZoneGroupState` XML) looking for the speaker
 * UUID as either a primary `ZoneGroupMember` or a nested `Satellite`. On
 * match, returns that group's `Coordinator` attribute.
 *
 * Edge-case contracts (per cel spike findings):
 * - **Speaker not present in topology** (offline, factory-reset UUID change,
 *   stale binding): throws `SonosError` with category `"unknown"`. Per
 *   prd-what.md §7.7, the PI surfaces this as a red dismissible alert
 *   prompting re-discovery — fail loudly, do not optimistically retry
 *   against the bound UUID (which would yield `701 Transition not
 *   available` and a confusing "speaker is busy" message).
 * - **Speaker briefly in two groups simultaneously** (mid-transition during
 *   a regroup): natural for-loop fall-through returns the first group's
 *   coordinator. Documented as out-of-scope; no fixture evidence the case
 *   occurs in practice within the 10-second polling cadence.
 * - **Bonded satellite** (sub, surround speaker, stereo-pair satellite):
 *   resolves to the parent ZoneGroupMember's group's coordinator. Verified
 *   against live home-theater capture.
 *
 * @param {string} speakerUuid — The bound speaker's UUID (e.g.
 *   `RINCON_xxxxxxxxxxxx01400`, where the middle hex segment is the
 *   speaker's MAC address).
 * @param {object} topology — Parsed `ZoneGroupState` JSON (the in-memory
 *   shape returned by `convertXmlToJson`). Pass `null`/`undefined` and the
 *   function throws — this is a programmer error, not a runtime condition.
 * @returns {string} The coordinator UUID for the bound speaker's group.
 * @throws {SonosError} category `"unknown"`, message includes the speaker
 *   UUID for diagnostic clarity.
 */
export function resolveCoordinator(speakerUuid, topology) {
  if (!speakerUuid) {
    throw new Error("resolveCoordinator: speakerUuid is required");
  }
  if (!topology) {
    throw new Error("resolveCoordinator: topology is required");
  }

  for (const group of asArray(topology.ZoneGroups?.ZoneGroup)) {
    const coordinator = group?._attributes?.Coordinator;
    for (const member of asArray(group.ZoneGroupMember)) {
      if (member?._attributes?.UUID === speakerUuid) {
        return coordinator;
      }
      for (const satellite of asArray(member.Satellite)) {
        if (satellite?._attributes?.UUID === speakerUuid) {
          return coordinator;
        }
      }
    }
  }

  throw new SonosError(
    `Bound speaker ${speakerUuid} not found in current ZoneGroupTopology`,
    "unknown",
  );
}
