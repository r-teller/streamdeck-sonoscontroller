/* eslint-disable no-unused-vars */
/* eslint-env browser */

// Web Worker–backed timer shim for plugin.html. Stream Deck's embedded webview
// throttles setTimeout/setInterval when the host app loses focus; polling stalls
// without this shim. Per prd-what.md §8.3 and backend.md §Conventions.
//
// The worker scope is wrapped from `timerFn`'s string body and constructed via
// a Blob URL — no external worker file required.
//
// Vitest fallback: if `Worker` isn't defined (Node test env), keep platform
// timers untouched. Production code path always runs in the Stream Deck webview
// where Worker is available.

if (typeof Worker !== "undefined") {
  const ESDTimerWorker = new Worker(
    URL.createObjectURL(
      new Blob(
        [
          timerFn
            .toString()
            .replace(/^[^{]*{\s*/, "")
            .replace(/\s*}[^}]*$/, ""),
        ],
        { type: "text/javascript" },
      ),
    ),
  );
  ESDTimerWorker.timerId = 1;
  ESDTimerWorker.timers = {};

  const ESDDefaultTimeouts = Object.freeze({
    timeout: 0,
    interval: 10,
  });

  const _setTimer = (callback, delay, type, params) => {
    const id = ESDTimerWorker.timerId++;
    ESDTimerWorker.timers[id] = { callback, params };
    ESDTimerWorker.onmessage = (e) => {
      if (ESDTimerWorker.timers[e.data.id]) {
        if (e.data.type === "clearTimer") {
          delete ESDTimerWorker.timers[e.data.id];
        } else {
          const cb = ESDTimerWorker.timers[e.data.id].callback;
          if (cb && typeof cb === "function") cb(...ESDTimerWorker.timers[e.data.id].params);
        }
      }
    };
    ESDTimerWorker.postMessage({ type, id, delay });
    return id;
  };

  const _setTimeoutESD = (...args) => {
    const [callback, delay = 0, ...params] = args;
    return _setTimer(callback, delay, "setTimeout", params);
  };

  const _setIntervalESD = (...args) => {
    const [callback, delay = 0, ...params] = args;
    return _setTimer(callback, delay, "setInterval", params);
  };

  const _clearTimerESD = (id) => {
    ESDTimerWorker.postMessage({ type: "clearTimeout", id });
    delete ESDTimerWorker.timers[id];
  };

  window.setTimeout = _setTimeoutESD;
  window.setInterval = _setIntervalESD;
  window.clearTimeout = _clearTimerESD;
  window.clearInterval = _clearTimerESD;
}

// Worker scope. Body is stringified and used as the Blob source above.
function timerFn() {
  let timers = {};
  const supportedCommands = ["setTimeout", "setInterval", "clearTimeout", "clearInterval"];

  function clearTimerAndRemove(id) {
    if (timers[id]) {
      clearTimeout(timers[id]);
      delete timers[id];
      postMessage({ type: "clearTimer", id });
    }
  }

  onmessage = function (e) {
    if (supportedCommands.includes(e.data.type) && timers[e.data.id]) {
      clearTimerAndRemove(e.data.id);
    }
    if (e.data.type === "setTimeout") {
      timers[e.data.id] = setTimeout(
        () => {
          postMessage({ id: e.data.id });
          clearTimerAndRemove(e.data.id);
        },
        Math.max(e.data.delay || 0),
      );
    } else if (e.data.type === "setInterval") {
      timers[e.data.id] = setInterval(
        () => {
          postMessage({ id: e.data.id });
        },
        Math.max(e.data.delay || 10),
      );
    }
  };
}
