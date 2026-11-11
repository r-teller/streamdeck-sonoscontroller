// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PiComponent from "@/components/PiComponent.vue";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

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

function createStubClient() {
  const handlers = {};
  return {
    saveSettings: vi.fn(),
    saveGlobalSettings: vi.fn(),
    requestGlobalSettings: vi.fn(),
    uuid: "pi-ctx",
    connected: true,
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      payload: {
        controller: "Keypad",
        settings: {},
      },
    },
    on: (event, cb) => {
      handlers[event] = cb;
    },
    __handlers: handlers,
  };
}

describe("PiComponent volume increment override", () => {
  let wrapper;
  let stubClient;

  async function mountForAction(shortName, settings = {}, globalSettings = undefined) {
    wrapper = mount(PiComponent);
    stubClient = createStubClient();
    wrapper.vm.sdClient = stubClient;
    wrapper.vm.actionUUID = `com.r-teller.sonoscontroller.${shortName}`;
    wrapper.vm.settings = settings;
    if (globalSettings !== undefined) {
      wrapper.vm.globalSettings = globalSettings;
    }
    await nextTick();
    await nextTick();
  }

  it("renders volume increment override section only for volume-up and volume-down actions", async () => {
    await mountForAction("volume-up");
    expect(wrapper.find('[data-pi-section="volume-increment-override"]').exists()).toBe(true);
    await mountForAction("volume-down");
    expect(wrapper.find('[data-pi-section="volume-increment-override"]').exists()).toBe(true);
    await mountForAction("toggle-play-pause");
    expect(wrapper.find('[data-pi-section="volume-increment-override"]').exists()).toBe(false);
    await mountForAction("currently-playing");
    expect(wrapper.find('[data-pi-section="volume-increment-override"]').exists()).toBe(false);
    await mountForAction("encoder-audio-equalizer");
    expect(wrapper.find('[data-pi-section="volume-increment-override"]').exists()).toBe(false);
  });

  it("shows placeholder default when no globalSettings", async () => {
    await mountForAction("volume-up", {});
    const input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.attributes("placeholder")).toBe("Global default: 10");
  });

  it("placeholder reflects globalSettings.adjustVolumeIncrement", async () => {
    await mountForAction("volume-up", {}, { adjustVolumeIncrement: 5 });
    let input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.attributes("placeholder")).toBe("Global default: 5");

    await mountForAction("volume-up", {}, { adjustVolumeIncrement: 1 });
    input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.attributes("placeholder")).toBe("Global default: 1");

    await mountForAction("volume-up", {}, {});
    input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.attributes("placeholder")).toBe("Global default: 10");
  });

  it("displays current adjustVolumeIncrement correctly", async () => {
    await mountForAction("volume-up", { adjustVolumeIncrement: 1 });
    let input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.element.value).toBe("1");

    await mountForAction("volume-up", { adjustVolumeIncrement: 0 });
    input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.element.value).toBe("0");

    await mountForAction("volume-up", { adjustVolumeIncrement: null });
    input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.element.value).toBe("");

    await mountForAction("volume-up", {});
    input = wrapper.find("[data-pi-volume-increment-override]");
    expect(input.element.value).toBe("");
  });

  it("saves numeric override and retains input value", async () => {
    await mountForAction("volume-up", {});
    const input = wrapper.find("[data-pi-volume-increment-override]");
    await input.setValue("1");
    expect(stubClient.saveSettings).toHaveBeenCalled();
    const payload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    expect(payload.adjustVolumeIncrement).toBe(1);
    expect(Object.keys(payload).length).toBe(26);
    expect(input.element.value).toBe("1");
  });

  it("clearing input results in null adjustVolumeIncrement", async () => {
    await mountForAction("volume-up", { adjustVolumeIncrement: 7 });
    const input = wrapper.find("[data-pi-volume-increment-override]");
    await input.setValue("");
    expect(stubClient.saveSettings).toHaveBeenCalled();
    const payload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    expect(payload.adjustVolumeIncrement).toBeNull();
  });

  it("buildSaveInput for non-volume actions sets adjustVolumeIncrement to null", async () => {
    await mountForAction("toggle-play-pause", {});
    const payload = wrapper.vm.buildSaveInput({});
    expect(payload.adjustVolumeIncrement).toBeNull();
  });
});
