// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));
vi.mock("bootstrap", () => ({
  Collapse: class {
    constructor() {
      this.show = vi.fn();
      this.hide = vi.fn();
      this.dispose = vi.fn();
    }
  },
}));

import SpeakerBindings from "@/components/SpeakerBindings.vue";
import PiComponent from "@/components/PiComponent.vue";

const OLD = "RINCON_OFFICEOLD01400";
const NEW = "RINCON_OFFICENEW01400";
const devices = {
  [NEW]: { uuid: NEW, zoneName: "Office", hostAddress: "192.168.50.80", isSatellite: false },
  KIT: { uuid: "KIT", zoneName: "Kitchen", hostAddress: "192.168.50.41", isSatellite: false },
};
const bindings = [
  { uuid: OLD, zoneName: "Den", hostAddress: "192.168.50.78", buttons: 4 },
  { uuid: NEW, zoneName: "Office", hostAddress: "192.168.50.80", buttons: 5 },
];

describe("SpeakerBindings.vue", () => {
  it("asks to connect first when no household is known", () => {
    const w = mount(SpeakerBindings, { props: { bindings, globals: {} } });
    expect(w.find("[data-pi-bindings-not-connected]").exists()).toBe(true);
  });

  it("shows Not found with a replace control, and Online for known speakers", () => {
    const w = mount(SpeakerBindings, { props: { bindings, globals: { devices } } });
    expect(w.find(`[data-pi-binding="${OLD}"]`).attributes("data-pi-binding-status")).toBe("missing");
    expect(w.find(`[data-pi-binding="${NEW}"]`).attributes("data-pi-binding-status")).toBe("online");
    expect(w.find(`[data-pi-binding="${OLD}"]`).text()).toContain("4 buttons on screen");
    expect(w.find(`[data-pi-replace-select="${OLD}"]`).exists()).toBe(true);
    expect(w.find(`[data-pi-replace-select="${NEW}"]`).exists()).toBe(false);
  });

  it("preselects the same-room speaker and emits replace", async () => {
    const officeOld = [{ uuid: OLD, zoneName: "Office", hostAddress: "192.168.50.78", buttons: 4 }];
    // Two Office speakers -> ambiguous, so the binding stays missing but Office is still preselected.
    const twoOffices = { ...devices, OTHER: { uuid: "OTHER", zoneName: "Office", hostAddress: "192.168.50.82" } };
    const w = mount(SpeakerBindings, { props: { bindings: officeOld, globals: { devices: twoOffices } } });
    await nextTick();
    expect(w.vm.choices[OLD]).toBe(NEW);
    await w.find(`[data-pi-replace-apply="${OLD}"]`).trigger("click");
    expect(w.emitted("replace")[0][0]).toEqual({ from: OLD, to: NEW });
  });

  it("shows replaced status, the active replacement and emits undo", async () => {
    const w = mount(SpeakerBindings, {
      props: { bindings, globals: { devices, speakerReplacements: { [OLD]: "KIT" } } },
    });
    expect(w.find(`[data-pi-binding="${OLD}"]`).attributes("data-pi-binding-status")).toBe("replaced");
    expect(w.find(`[data-pi-replacement="${OLD}"]`).text()).toContain("Kitchen (192.168.50.41)");
    await w.find(`[data-pi-replacement-undo="${OLD}"]`).trigger("click");
    expect(w.emitted("undo")[0][0]).toEqual({ from: OLD });
  });
});

describe("PiComponent speaker bindings integration", () => {
  function client() {
    const handlers = {};
    return {
      saveSettings: vi.fn(),
      saveGlobalSettings: vi.fn(),
      requestGlobalSettings: vi.fn(),
      sendToPlugin: vi.fn(),
      openUrl: vi.fn(),
      uuid: "pi-ctx",
      connected: true,
      actionInfo: {
        action: "com.r-teller.sonoscontroller.toggle-mute-unmute",
        payload: { controller: "Keypad", settings: { uuid: OLD, zoneName: "Den", hostAddress: "192.168.50.78", title: "Den (192.168.50.78)" } },
      },
      on: (event, cb) => {
        handlers[event] = cb;
      },
      handlers,
    };
  }

  it("requests bindings on connect, renders pushed bindings and warns about the missing speaker", async () => {
    const w = mount(PiComponent);
    const c = client();
    w.vm.bindStreamDeck(c);
    expect(c.sendToPlugin).toHaveBeenCalledWith({
      action: "com.r-teller.sonoscontroller.toggle-mute-unmute",
      context: "pi-ctx",
      payload: { type: "getBindings" },
    });
    c.handlers.globalsettings({ devices });
    c.handlers.sendToPropertyInspector({ payload: { type: "bindings", bindings } });
    await nextTick();
    expect(w.vm.bindings).toEqual(bindings);
    expect(w.find("[data-pi-speaker-missing-alert]").exists()).toBe(true);
    expect(w.find(`[data-pi-binding="${OLD}"]`).exists()).toBe(true);
  });

  it("replace and undo write speakerReplacements into global settings", async () => {
    vi.useFakeTimers();
    const w = mount(PiComponent);
    const c = client();
    w.vm.bindStreamDeck(c);
    c.handlers.globalsettings({ devices });
    w.vm.onReplaceSpeaker({ from: OLD, to: NEW });
    expect(c.saveGlobalSettings.mock.lastCall[0].payload.speakerReplacements).toEqual({ [OLD]: NEW });
    expect(c.saveGlobalSettings.mock.lastCall[0].payload.devices).toEqual(devices);
    await nextTick();
    expect(w.find("[data-pi-speaker-missing-alert]").exists()).toBe(false);
    w.vm.onUndoReplacement({ from: OLD });
    expect(c.saveGlobalSettings.mock.lastCall[0].payload.speakerReplacements).toEqual({});
    vi.advanceTimersByTime(600);
    expect(c.sendToPlugin).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("hides the profiles folder link outside Stream Deck (non-file origin)", () => {
    const w = mount(PiComponent);
    expect(w.vm.profilesFolderUrl).toBeNull();
    expect(w.find("[data-pi-open-profiles]").exists()).toBe(false);
  });
});
