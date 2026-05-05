// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SonosSelection from "@/components/SonosSelection.vue";

const SPEAKERS = [
  {
    uuid: "RINCON_office",
    zoneName: "office",
    hostAddress: "192.168.1.42",
    isSatellite: false,
  },
  {
    uuid: "RINCON_living",
    zoneName: "Living Room",
    hostAddress: "192.168.1.43",
    isSatellite: false,
  },
  {
    uuid: "RINCON_surround",
    zoneName: "Surround Right",
    hostAddress: "192.168.1.55",
    isSatellite: true,
  },
  {
    uuid: "RINCON_arc",
    zoneName: "Arc",
    hostAddress: "192.168.1.50",
    isSatellite: false,
  },
];

describe("SonosSelection — hint line (orw.3 AC)", () => {
  it("AC: shows verbatim hint line above the picker", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    expect(wrapper.find("[data-pi-satellite-hint]").text()).toBe(
      "Note: Devices marked with 🛰️ are satellites",
    );
  });
});

describe("SonosSelection — picker (orw.3 AC)", () => {
  it("AC: select element has size=5", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    expect(wrapper.find("select").attributes("size")).toBe("5");
  });

  it("AC: each option label is `<ZoneName> (<HostAddress>)` with 🛰️ when satellite", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    const options = wrapper.findAll("option").map((o) => o.text());
    expect(options).toContain("Living Room (192.168.1.43)");
    expect(options).toContain("Surround Right (192.168.1.55) 🛰️");
    expect(options).toContain("Arc (192.168.1.50)");
    expect(options).toContain("office (192.168.1.42)");
  });

  it("AC: options are sorted alphabetically, case-insensitively", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    const labels = wrapper.findAll("option").map((o) => o.text());
    const expected = [
      "Arc (192.168.1.50)",
      "Living Room (192.168.1.43)",
      "office (192.168.1.42)",
      "Surround Right (192.168.1.55) 🛰️",
    ];
    expect(labels).toEqual(expected);
  });

  it("renders empty option list when no speakers", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: [] },
    });
    expect(wrapper.findAll("option")).toHaveLength(0);
  });
});

describe("SonosSelection — filter input (orw.3 AC)", () => {
  it("AC: filter placeholder is verbatim", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    expect(wrapper.find("input[type=text]").attributes("placeholder")).toBe(
      "Filter by name or Sonos Speaker ID...",
    );
  });

  it("AC: typing in the filter narrows the list (matches label, case-insensitive)", async () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    await wrapper.find("input[type=text]").setValue("OFFICE");
    const labels = wrapper.findAll("option").map((o) => o.text());
    expect(labels).toEqual(["office (192.168.1.42)"]);
  });

  it("AC: filter matches against UUID, case-insensitive", async () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    await wrapper.find("input[type=text]").setValue("rincon_living");
    const labels = wrapper.findAll("option").map((o) => o.text());
    expect(labels).toEqual(["Living Room (192.168.1.43)"]);
  });

  it("AC: clearing the filter restores the full sorted list", async () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    const input = wrapper.find("input[type=text]");
    await input.setValue("OFFICE");
    expect(wrapper.findAll("option")).toHaveLength(1);
    await input.setValue("");
    expect(wrapper.findAll("option")).toHaveLength(4);
  });

  it("AC: filter input is component-local (not a prop, not v-model'd)", () => {
    // Filter resets when component remounts (PI close/reopen analogue).
    const w1 = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    w1.find("input[type=text]").setValue("office");
    const w2 = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    expect(w2.find("input[type=text]").element.value).toBe("");
  });
});

describe("SonosSelection — selection emit (orw.3 AC)", () => {
  it("AC: emits update:modelValue + selection-saved on change with the new UUID", async () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: null, speakers: SPEAKERS },
    });
    const select = wrapper.find("select");
    await select.setValue("RINCON_living");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")[0]).toEqual(["RINCON_living"]);
    expect(wrapper.emitted("selection-saved")).toBeTruthy();
    expect(wrapper.emitted("selection-saved")[0]).toEqual(["RINCON_living"]);
  });

  it("AC: select reflects modelValue prop on initial render", () => {
    const wrapper = mount(SonosSelection, {
      props: { modelValue: "RINCON_living", speakers: SPEAKERS },
    });
    expect(wrapper.find("select").element.value).toBe("RINCON_living");
  });
});
