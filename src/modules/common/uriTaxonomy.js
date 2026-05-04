// Sonos AVTransport URI classification + factory table for input-source
// cycling. Pure module — no I/O, no SOAP. Used by:
//   - km1.5 (Toggle Input Source) to detect the current source and build the
//     next URI as `<prefix>:<COORDINATOR_UUID><suffix>`.
//   - km1.1 (Currently Playing tile) to label "what is the speaker doing now".
//
// Classification table (verbatim from data-model.md §"URI taxonomy" and
// prd-what.md §5.5):
//
//   | URI starts with     | URI ends with | Maps to     |
//   | x-sonos-htastream   | :spdif        | TV_Input    |
//   | x-rincon-stream     | (any)         | Line_In     |
//   | (anything else)     | —             | Sonos_Queue |
//
// The informational prefixes documented in data-model.md
// (`x-sonos-spotify:`, `x-sonos-http:`, `x-sonosapi-stream:`) all fall through
// to Sonos_Queue here. The `x-sonosapi-stream:` special handling for Play
// Favorite lives in h75.6 `setServiceURI`, not in this classifier.

/** @typedef {"Sonos_Queue" | "TV_Input" | "Line_In"} InputSource */

/**
 * @typedef {Object} InputSourceMapping
 * @property {InputSource} currentSource — Classification of the inspected URI.
 * @property {string} prefix — Factory prefix for THIS source. Joined by the
 *   action layer as `<prefix>:<COORDINATOR_UUID><suffix>` to build the next
 *   `SetAVTransportURI` payload when cycling.
 * @property {string} suffix — Factory suffix for THIS source. May be empty.
 */

const FACTORIES = Object.freeze({
  TV_Input: Object.freeze({ prefix: "x-sonos-htastream", suffix: ":spdif" }),
  Line_In: Object.freeze({ prefix: "x-rincon-stream", suffix: "" }),
  Sonos_Queue: Object.freeze({ prefix: "x-rincon-queue", suffix: "#0" }),
});

/**
 * Classify an AVTransport URI and return the factory pieces for its source.
 *
 * @param {string|undefined|null} uri — The current AVTransport URI string.
 *   Empty / nullish input returns the safe Sonos_Queue default.
 * @returns {InputSourceMapping}
 */
export function getInputSourceMappings(uri) {
  if (typeof uri !== "string" || uri.length === 0) {
    return { currentSource: "Sonos_Queue", ...FACTORIES.Sonos_Queue };
  }

  if (uri.startsWith("x-sonos-htastream") && uri.endsWith(":spdif")) {
    return { currentSource: "TV_Input", ...FACTORIES.TV_Input };
  }

  if (uri.startsWith("x-rincon-stream")) {
    return { currentSource: "Line_In", ...FACTORIES.Line_In };
  }

  return { currentSource: "Sonos_Queue", ...FACTORIES.Sonos_Queue };
}

/**
 * Factory table for the three target sources. Exposed for action-layer code
 * that needs to construct a next-URI for any source independent of the
 * currently-playing one.
 */
export const INPUT_SOURCE_FACTORIES = FACTORIES;
