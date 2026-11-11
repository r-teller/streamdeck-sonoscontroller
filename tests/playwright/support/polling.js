import { expect } from "@playwright/test";

/** Time for a poll result to reach the frames after the Get* call (state update + render). */
export const POLL_SETTLE_MS = 300;

/**
 * Waits until the plugin has polled `getAction` after the n-th `setAction` call, then gives the
 * render a moment. Use it to check that a change "sticks": the plugin re-polls right after every
 * action (sonos-e9y), and the stateful mock speaker reports what was set (sonos-8px.2).
 *
 * @param {import("@playwright/test").Page} page
 * @param {{calls: Array<{action: string}>}} mock - from installMockSonos
 * @param {{set: string, get: string, n?: number, timeout?: number}} opts
 */
export async function waitForPollAfter(page, mock, { set, get, n = 1, timeout = 8000 }) {
  await expect
    .poll(
      () => {
        const target = mock.calls.filter((c) => c.action === set)[n - 1];
        const i = mock.calls.indexOf(target);
        return i >= 0 && mock.calls.slice(i + 1).some((c) => c.action === get);
      },
      { timeout, message: `no ${get} poll after ${set} #${n}` },
    )
    .toBe(true);
  await page.waitForTimeout(POLL_SETTLE_MS);
}
