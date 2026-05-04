// Boundary translation for the Sonos integration layer. The PI surfaces a
// thrown error's `.message` verbatim inside its red dismissible alert (per
// prd-what.md §7.7), so this module is the user's only window into Sonos
// failures. A programmer artifact ("u is not iterable", "fetch failed",
// "Cannot read properties of undefined", raw TypeError) must never reach the
// alert.
//
// The transport (sonosService.js) categorizes its own failures and throws
// `SonosError` instances. Each public method on `SonosController` (and every
// per-action wrapper from h75.6) wraps its catch clause with
// `translateSonosError(err, {op, host, port, timeoutSec})` and rethrows the
// translated message. The op name is the user-facing label ("get devices",
// "play", "set volume") — never an SDK or internal name.

/**
 * Categorized transport-layer error. Carries enough context for the boundary
 * translator to produce a per-op message without parsing strings.
 */
export class SonosError extends Error {
  /**
   * @param {string} message — Pre-translated transport message; useful when
   *   bubbling without further translation (e.g., for logs).
   * @param {"timeout"|"network"|"fault"|"http"|"parse"|"unknown"} category
   * @param {object} [context] — Per-category fields:
   *   - timeout: `{host, port, timeoutMs}`
   *   - network: `{host, port, cause}`
   *   - fault:   `{host, port, faultCode, faultDescription, status}`
   *   - http:    `{host, port, status}`
   *   - parse:   `{host, port}`
   */
  constructor(message, category, context = {}) {
    super(message);
    this.name = "SonosError";
    this.category = category;
    this.context = context;
  }
}

const REGRESSION_MARKERS = /is not iterable|Cannot read prop/i;

/**
 * Translate any error from the Sonos integration layer into a user-facing
 * message of the form `"Failed to <op>: <translated cause>"`.
 *
 * Handles:
 *   - SonosError (the categorized transport errors from sonosService).
 *   - TypeError matching the PR #3 regression class ("is not iterable" /
 *     "Cannot read properties") — the safety net for any code path that
 *     forgot `asArray`. Should be unreachable once h75.3's discipline is in
 *     place; the safety net keeps a regression user-visible.
 *   - Anything else: wraps with the op prefix and the underlying message.
 *
 * @param {Error} err
 * @param {object} ctx
 * @param {string} ctx.op — Operation label, e.g. "get devices", "play".
 * @param {string} [ctx.host] — Used to enrich timeout/network/parse messages.
 * @param {number} [ctx.port]
 * @param {number} [ctx.timeoutSec] — Used to enrich timeout messages.
 * @returns {Error} A new `Error` with the translated `.message`. The original
 *   error is preserved as `.cause` for diagnostics.
 */
export function translateSonosError(err, { op, host, port, timeoutSec } = {}) {
  const prefix = `Failed to ${op}`;

  if (err instanceof SonosError) {
    const { category, context } = err;
    const where = `${context.host ?? host}:${context.port ?? port}`;
    let message;
    switch (category) {
      case "timeout": {
        const seconds = context.timeoutMs != null ? context.timeoutMs / 1000 : timeoutSec;
        message = `${prefix}: Timeout while reaching ${where} after ${seconds ?? "?"} seconds`;
        break;
      }
      case "network":
        message = `${prefix}: Could not reach ${where}`;
        break;
      case "fault":
        message = `${prefix}: Sonos returned error ${context.faultCode}: ${context.faultDescription}`;
        break;
      case "http":
        message = `${prefix}: Sonos returned HTTP ${context.status}`;
        break;
      case "parse":
        message = `${prefix}: Could not parse response from ${where}`;
        break;
      default:
        message = `${prefix}: ${err.message || "unexpected error"}`;
    }
    return new Error(message, { cause: err });
  }

  if (err instanceof TypeError && REGRESSION_MARKERS.test(err.message)) {
    return new Error(`${prefix}: Unexpected response shape from ${host}:${port}`, { cause: err });
  }

  return new Error(`${prefix}: ${err?.message || "unexpected error"}`, { cause: err });
}
