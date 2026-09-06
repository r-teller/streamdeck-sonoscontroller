/**
 * Operational status enum for Stream Deck plugin.
 * Transition contract:
 * UNINITIALIZED → UPDATING
 * UPDATING      → UPDATED | DISCONNECTED | RATE_LIMITED
 * UPDATED       → UPDATING | DISCONNECTED
 * DISCONNECTED  → UPDATING            (recovery attempt)
 * RATE_LIMITED  → UPDATING            (after the 10 s window decays)
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
