/* eslint-env browser */

// Extract function body: strip "function (...) {" and trailing "}"
function extractBody(fn) {
  const str = fn.toString();
  const openBrace = str.indexOf("{");
  const closeBrace = str.lastIndexOf("}");
  if (openBrace === -1 || closeBrace === -1 || closeBrace <= openBrace) {
    return "";
  }
  return str.slice(openBrace + 1, closeBrace).trim();
}

// Worker script as a function (will be stringified)
const workerScript = function () {
  const timeouts = new Map();
  const intervals = new Map();
  let nextId = 1;

  function schedule(type, delay, id) {
    // Floor: timeout 0ms, interval 10ms
    const effectiveDelay = Math.max(type === "timeout" ? 0 : 10, delay);

    const timerId = id || nextId++;

    // Clear existing if re-scheduling same id
    if (type === "timeout") {
      if (timeouts.has(timerId)) {
        clearTimeout(timeouts.get(timerId));
        timeouts.delete(timerId);
      }
    } else {
      if (intervals.has(timerId)) {
        clearInterval(intervals.get(timerId));
        intervals.delete(timerId);
      }
    }

    const timerFn = () => {
      if (type === "timeout") {
        postMessage({ type: "timeout", id: timerId });
        timeouts.delete(timerId);
      } else {
        postMessage({ type: "interval", id: timerId });
      }
    };

    const timer = setTimeout(timerFn, effectiveDelay);

    if (type === "timeout") {
      timeouts.set(timerId, timer);
    } else {
      intervals.set(timerId, timer);
    }

    return timerId;
  }

  self.onmessage = function (e) {
    const { action, type, delay, id } = e.data;

    if (action === "schedule") {
      const timerId = schedule(type, delay, id);
      postMessage({ type: "ack", id: timerId });
    } else if (action === "clear") {
      if (type === "timeout") {
        if (timeouts.has(id)) {
          clearTimeout(timeouts.get(id));
          timeouts.delete(id);
        }
      } else {
        if (intervals.has(id)) {
          clearInterval(intervals.get(id));
          intervals.delete(id);
        }
      }
    }
  };
};

// Safe to import under Node (vitest) — no-op if Worker is unavailable
if (typeof Worker !== "undefined" && typeof window !== "undefined") {
  // Build worker blob from function body
  const workerBody = extractBody(workerScript);
  const blob = new Blob([workerBody], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);

  // Main-side tracking: id -> { callback, params }
  const callbacks = new Map();
  let nextId = 1;

  // Handle messages from worker
  worker.onmessage = function (e) {
    const { type, id } = e.data;
    if (type === "ack") {
      // Already handled by return value of schedule call
    } else if (type === "timeout" || type === "interval") {
      const entry = callbacks.get(id);
      if (entry) {
        try {
          entry.callback(...entry.params);
        } catch (err) {
          // Swallow errors to avoid breaking the worker
        }
        // For timeouts, remove after execution
        if (type === "timeout") {
          callbacks.delete(id);
        }
      }
    }
  };

  // Override timer functions
  const originalSetTimeout = window.setTimeout;
  const originalSetInterval = window.setInterval;
  const originalClearTimeout = window.clearTimeout;
  const originalClearInterval = window.clearInterval;

  window.setTimeout = function (callback, delay, ...params) {
    if (typeof callback !== "function") {
      return originalSetTimeout(callback, delay, ...params);
    }

    const id = nextId++;
    callbacks.set(id, { callback, params });

    worker.postMessage({
      action: "schedule",
      type: "timeout",
      delay: Math.max(0, delay || 0),
      id,
    });

    return id;
  };

  window.setInterval = function (callback, delay, ...params) {
    if (typeof callback !== "function") {
      return originalSetInterval(callback, delay, ...params);
    }

    const id = nextId++;
    callbacks.set(id, { callback, params });

    worker.postMessage({
      action: "schedule",
      type: "interval",
      delay: Math.max(10, delay || 0),
      id,
    });

    return id;
  };

  window.clearTimeout = function (id) {
    if (callbacks.has(id)) {
      worker.postMessage({
        action: "clear",
        type: "timeout",
        id,
      });
      callbacks.delete(id);
    }
    return originalClearTimeout(id);
  };

  window.clearInterval = function (id) {
    if (callbacks.has(id)) {
      worker.postMessage({
        action: "clear",
        type: "interval",
        id,
      });
      callbacks.delete(id);
    }
    return originalClearInterval(id);
  };

  // Expose teardown for tests/hot reload
  window.__teardownWorkerTimers = function () {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    window.setTimeout = originalSetTimeout;
    window.setInterval = originalSetInterval;
    window.clearTimeout = originalClearTimeout;
    window.clearInterval = originalClearInterval;
    callbacks.clear();
  };
}

// Export for Node tests (no-op if not in browser)
export { extractBody };
