export class SonosError extends Error {
  constructor(message, category, context = {}) {
    super(message);
    this.name = "SonosError";
    this.category = category;
    this.context = context;
  }
}

export function translateSonosError(err, { op, host, port, timeoutSec } = {}) {
  const detail = getDetail(err, { host, port, timeoutSec });

  return new Error(`Failed to ${op}: ${detail}`, {
    cause: err,
  });
}

function getDetail(err, { host, port, timeoutSec }) {
  if (err instanceof SonosError) {
    switch (err.category) {
      case "timeout": {
        const timeoutMs = err.context?.timeoutMs;
        const seconds =
          typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
            ? timeoutMs / 1000
            : typeof timeoutSec === "number" && Number.isFinite(timeoutSec)
              ? timeoutSec
              : "?";
        return `Timeout while reaching ${host}:${port} after ${seconds} seconds`;
      }
      case "network":
        return `Could not reach ${host}:${port}`;
      case "fault": {
        const faultCode = err.context?.faultCode;
        const faultDescription = err.context?.faultDescription;
        return `Sonos returned error ${faultCode}: ${faultDescription}`;
      }
      case "http": {
        const status = err.context?.status;
        return `Sonos returned HTTP ${status}`;
      }
      case "parse":
        return `Could not parse response from ${host}:${port}`;
      default:
        return getSafeDetail(err.message, { host, port });
    }
  }

  if (err instanceof TypeError) {
    if (/is not iterable|Cannot read prop/i.test(err.message)) {
      return `Unexpected response shape from ${host}:${port}`;
    }
  }

  return getSafeDetail(err.message || "unexpected error", { host, port });
}

function getSafeDetail(detail, { host, port }) {
  const forbidden = ["TypeError", "fetch failed", "is not iterable", "Cannot read prop"];

  const lowerDetail = detail.toLowerCase();
  for (const term of forbidden) {
    if (lowerDetail.includes(term.toLowerCase())) {
      return `Unexpected response shape from ${host}:${port}`;
    }
  }

  return detail;
}
