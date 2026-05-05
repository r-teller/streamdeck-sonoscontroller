/**
 * Operational status enum for `SpeakerRecord.operationalStatus`.
 *
 * Shared vocabulary consumed by the speaker store, polling supervisor,
 * action dispatcher, and render layer to decide whether a speaker is
 * currently fetchable, whether to surface an alert, and whether to
 * skip a poll cycle.
 *
 * Values are strings equal to their keys so logs and bead-driven
 * tests stay human-readable across minification.
 *
 * Legal transitions (consumers should not move outside these edges;
 * the runtime is permissive but new code should follow this contract):
 *
 *   UNINITIALIZED → UPDATING
 *   UPDATING      → UPDATED | DISCONNECTED | RATE_LIMITED
 *   UPDATED       → UPDATING | DISCONNECTED
 *   DISCONNECTED  → UPDATING                  (recovery attempt)
 *   RATE_LIMITED  → UPDATING                  (after 10s window decay)
 *
 * `CONNECTED` and `CONNECTING` are present per prd-what.md §2.3 but
 * have no current writers — reserved for future use.
 *
 * See data-model.md §Enums and backend.md §"Speaker store" for the
 * surrounding semantics; prd-what.md §8.3 for the DISCONNECTED /
 * RATE_LIMITED user-visible behavior.
 */
export const OPERATIONAL_STATUS = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  UPDATING: "UPDATING",
  UPDATED: "UPDATED",
  CONNECTED: "CONNECTED",
  CONNECTING: "CONNECTING",
  DISCONNECTED: "DISCONNECTED",
  RATE_LIMITED: "RATE_LIMITED",
});
