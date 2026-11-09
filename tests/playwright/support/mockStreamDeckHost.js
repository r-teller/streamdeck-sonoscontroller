// MockStreamDeckHost - injected via page.addInitScript
export const mockStreamDeckHostSource = `
(() => {
  const __sdOutbound = [];
  const sockets = [];
  let lastSocket = null;

  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.onopen = null;
      this.onclose = null;
      this.onmessage = null;
      this._queueMicrotask(() => {
        this.readyState = 1; // OPEN
        if (this.onopen) {
          this.onopen({});
        }
      });
      sockets.push(this);
      lastSocket = this;
    }

    send(data) {
      const frame = typeof data === 'string' ? JSON.parse(data) : data;
      __sdOutbound.push(frame);
    }

    close() {
      this.readyState = 3; // CLOSED
      if (this.onclose) {
        this.onclose({ code: 1000, reason: '' });
      }
    }

    _queueMicrotask(fn) {
      Promise.resolve().then(fn);
    }
  }

  window.WebSocket = MockWebSocket;

  window.__sdOutbound = __sdOutbound;
  window.__sdInject = (frameObj) => {
    if (lastSocket && lastSocket.onmessage) {
      lastSocket.onmessage({ data: JSON.stringify(frameObj) });
    }
  };

  // Expose helper API on window.sd for tests
  window.sd = {
    outbound: (filter) => {
      if (!filter) return [...__sdOutbound];
      return __sdOutbound.filter(f => f.event === filter);
    },
    clearOutbound: () => {
      __sdOutbound.length = 0;
    },
    inject: {
      willAppear: (ctx, action, settings, controller = 'Keypad') => {
        window.__sdInject({
          event: 'willAppear',
          action,
          context: ctx,
          payload: { settings, controller, state: 0 }
        });
      },
      didReceiveSettings: (ctx, settings) => {
        window.__sdInject({
          event: 'didReceiveSettings',
          action: '',
          context: ctx,
          payload: { settings }
        });
      },
      globalSettings: (settings) => {
        window.__sdInject({
          event: 'didReceiveGlobalSettings',
          payload: { settings }
        });
      },
      keyDown: (ctx) => {
        window.__sdInject({ event: 'keyDown', context: ctx, payload: {} });
      },
      dialRotate: (ctx, ticks = 1) => {
        window.__sdInject({ event: 'dialRotate', context: ctx, payload: { ticks } });
      },
      touchTap: (ctx) => {
        window.__sdInject({ event: 'touchTap', context: ctx, payload: {} });
      },
      willDisappear: (ctx) => {
        window.__sdInject({ event: 'willDisappear', context: ctx, payload: {} });
      }
    }
  };
})()
`;

// Factory to create helper API bound to a specific page
export function createMockHost(page) {
  return {
    outbound: async (filter) => {
      return await page.evaluate((f) => window.sd.outbound(f), filter ?? null);
    },
    clearOutbound: async () => {
      await page.evaluate(() => window.sd.clearOutbound());
    },
    inject: {
      willAppear: async (ctx, action, settings, controller = 'Keypad') => {
        await page.evaluate(
          ({ ctx, action, settings, controller }) => window.sd.inject.willAppear(ctx, action, settings, controller),
          { ctx, action, settings, controller }
        );
      },
      didReceiveSettings: async (ctx, settings) => {
        await page.evaluate(
          ({ ctx, settings }) => window.sd.inject.didReceiveSettings(ctx, settings),
          { ctx, settings }
        );
      },
      globalSettings: async (settings) => {
        await page.evaluate(
          (settings) => window.sd.inject.globalSettings(settings),
          settings
        );
      },
      keyDown: async (ctx) => {
        await page.evaluate((ctx) => window.sd.inject.keyDown(ctx), ctx);
      },
      dialRotate: async (ctx, ticks = 1) => {
        await page.evaluate(({ ctx, ticks }) => window.sd.inject.dialRotate(ctx, ticks), { ctx, ticks });
      },
      touchTap: async (ctx) => {
        await page.evaluate((ctx) => window.sd.inject.touchTap(ctx), ctx);
      },
      willDisappear: async (ctx) => {
        await page.evaluate((ctx) => window.sd.inject.willDisappear(ctx), ctx);
      }
    }
  };
}

// Helper to connect to the mock host
export async function connect(page, { uuid, registerEvent, actionInfo }) {
  const actionInfoJson = actionInfo ? (typeof actionInfo === 'string' ? actionInfo : JSON.stringify(actionInfo)) : null;
  await page.evaluate(
    ({ port, uuid, registerEvent, actionInfoJson }) =>
      window.connectElgatoStreamDeckSocket(port, uuid, registerEvent, '{}', actionInfoJson),
    { port: 9999, uuid, registerEvent, actionInfoJson }
  );
}
