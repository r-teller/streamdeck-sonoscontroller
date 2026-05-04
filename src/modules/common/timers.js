/* eslint-env browser */

// Web Worker–backed timer shim for plugin.html. Stream Deck's embedded webview
// throttles setTimeout/setInterval when the host app loses focus; polling stalls
// without this shim. Per prd-what.md §8.3.
//
// The worker scope is wrapped from `workerBody`'s string body and constructed
// via a Blob URL — no external worker file needed.
//
// Vitest fallback: if `Worker` isn't defined (Node test env), keep platform
// timers untouched. Production code path always runs in the Stream Deck webview
// where Worker is available.

if (typeof Worker !== "undefined") {
  installWorkerTimers();
}

function installWorkerTimers() {
  const worker = new Worker(URL.createObjectURL(new Blob([extractBody(workerBody)], { type: "text/javascript" })));

  // id → registered callback + params. Worker fires by id; main thread looks
  // up the callback and invokes it. IDs are generated on the main thread so
  // clearTimeout/clearInterval can cancel before the worker's fire arrives.
  const timers = new Map();
  let nextId = 1;

  worker.addEventListener("message", (e) => {
    const { type, id } = e.data;
    if (type === "clearTimer") {
      timers.delete(id);
      return;
    }
    // Worker fired a timer. Look up callback; invoke if still registered.
    const entry = timers.get(id);
    if (entry) entry.callback(...entry.params);
  });

  const schedule = (callback, delay, type, params) => {
    const id = nextId++;
    timers.set(id, { callback, params });
    worker.postMessage({ type, id, delay });
    return id;
  };

  const cancel = (id) => {
    if (id == null) return;
    worker.postMessage({ type: "clearTimeout", id });
    timers.delete(id);
  };

  window.setTimeout = (callback, delay = 0, ...params) => schedule(callback, delay, "setTimeout", params);
  window.setInterval = (callback, delay = 0, ...params) => schedule(callback, delay, "setInterval", params);
  window.clearTimeout = cancel;
  window.clearInterval = cancel;

  // Expose teardown for tests / hot reload. Plugin reload terminates the
  // webview anyway, but explicit cleanup prevents leaks during dev.
  window.__teardownWorkerTimers = () => {
    worker.terminate();
    timers.clear();
  };
}

// Strips the outer `function name() { ... }` wrapper to extract the body for
// Blob/Worker construction. Resilient to minification (single-line function
// definitions still match because `[^{]*` is greedy-matching everything before
// the first `{`).
function extractBody(fn) {
  return fn
    .toString()
    .replace(/^[^{]*\{\s*/, "")
    .replace(/\s*\}[^}]*$/, "");
}

// Worker scope. Body is stringified and used as the Blob source above.
// Inside the worker, setTimeout/setInterval are the platform's REAL ones —
// workers are not throttled by the embedding webview's focus state, which is
// the entire point of this shim.
function workerBody() {
  const timers = new Map();
  const supportedCommands = new Set(["setTimeout", "setInterval", "clearTimeout", "clearInterval"]);

  function clearTimerAndRemove(id) {
    const handle = timers.get(id);
    if (handle == null) return;
    clearTimeout(handle); // works for both setTimeout and setInterval
    timers.delete(id);
    postMessage({ type: "clearTimer", id });
  }

  onmessage = (e) => {
    const { type, id, delay } = e.data;
    if (!supportedCommands.has(type)) return;

    if (timers.has(id)) clearTimerAndRemove(id);

    const safeDelay = Math.max(0, delay || 0);

    if (type === "setTimeout") {
      timers.set(
        id,
        setTimeout(() => {
          postMessage({ id });
          clearTimerAndRemove(id);
        }, safeDelay),
      );
    } else if (type === "setInterval") {
      const intervalDelay = Math.max(10, safeDelay);
      timers.set(
        id,
        setInterval(() => {
          postMessage({ id });
        }, intervalDelay),
      );
    }
  };
}
