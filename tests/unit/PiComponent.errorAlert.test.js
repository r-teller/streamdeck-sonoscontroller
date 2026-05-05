// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));

import PiComponent from "@/components/PiComponent.vue";

describe("PiComponent — error alert (orw.10)", () => {
  let wrapper;

  beforeEach(() => {
    wrapper = mount(PiComponent);
  });

  it("renders no alert when errorMessage is null (no empty shell)", () => {
    expect(wrapper.find("[data-pi-error-alert]").exists()).toBe(false);
  });

  it("AC: shows verbatim error message in the alert when errorMessage is set", async () => {
    wrapper.vm.errorMessage =
      "Failed to get devices: Timeout while getting devices after 10 seconds";
    await wrapper.vm.$nextTick();
    const alert = wrapper.find("[data-pi-error-alert]");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain(
      "Failed to get devices: Timeout while getting devices after 10 seconds",
    );
  });

  it("AC: shows different verbatim message (Could not reach...)", async () => {
    wrapper.vm.errorMessage = "Could not reach 192.168.1.42:1400";
    await wrapper.vm.$nextTick();
    const alert = wrapper.find("[data-pi-error-alert]");
    expect(alert.text()).toContain("Could not reach 192.168.1.42:1400");
  });

  it("AC: alert uses Bootstrap alert-danger styling and dismissible classes", async () => {
    wrapper.vm.errorMessage = "x";
    await wrapper.vm.$nextTick();
    const alert = wrapper.find("[data-pi-error-alert]");
    expect(alert.classes()).toContain("alert");
    expect(alert.classes()).toContain("alert-danger");
    expect(alert.classes()).toContain("alert-dismissible");
  });

  it("AC: clicking X dismisses the alert (errorMessage set to null, alert removed)", async () => {
    wrapper.vm.errorMessage = "Some error";
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-pi-error-alert]").exists()).toBe(true);

    await wrapper.find("[data-pi-error-alert] .btn-close").trigger("click");

    expect(wrapper.vm.errorMessage).toBe(null);
    expect(wrapper.find("[data-pi-error-alert]").exists()).toBe(false);
  });

  it("AC: dismissError() programmatically clears errorMessage", () => {
    wrapper.vm.errorMessage = "X";
    wrapper.vm.dismissError();
    expect(wrapper.vm.errorMessage).toBe(null);
  });

  it("AC: second failure after dismissal re-renders the alert with the new message", async () => {
    wrapper.vm.errorMessage = "First error";
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-pi-error-alert]").text()).toContain(
      "First error",
    );

    await wrapper.find("[data-pi-error-alert] .btn-close").trigger("click");
    expect(wrapper.find("[data-pi-error-alert]").exists()).toBe(false);

    wrapper.vm.errorMessage = "Second error";
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-pi-error-alert]").exists()).toBe(true);
    expect(wrapper.find("[data-pi-error-alert]").text()).toContain(
      "Second error",
    );
  });

  it("AC: alert is rendered inside the global-settings section (above form inputs)", async () => {
    wrapper.vm.errorMessage = "x";
    await wrapper.vm.$nextTick();
    const section = wrapper.find('[data-pi-section="global-settings"]');
    expect(section.exists()).toBe(true);
    expect(section.find("[data-pi-error-alert]").exists()).toBe(true);
  });

  it("AC: alert text is rendered verbatim — does NOT scrub or wrap programmer-style strings (boundary owns translation)", async () => {
    // The alert is a passive consumer. If a programmer-artifact string ever
    // reaches here, that's a Phase 2 boundary-translation bug — orw.10 must
    // not silently mask it by scrubbing.
    wrapper.vm.errorMessage = "u is not iterable";
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-pi-error-alert]").text()).toContain(
      "u is not iterable",
    );
  });
});
