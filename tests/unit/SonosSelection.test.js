// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import SonosSelection from "@/components/SonosSelection.vue";

const speakersFixture = [
  { uuid: "RINCON_AAA", zoneName: "office", hostAddress: "192.168.1.42", isSatellite: false },
  { uuid: "RINCON_BBB", zoneName: "Bedroom", hostAddress: "192.168.1.43", isSatellite: true },
  { uuid: "RINCON_CCC", zoneName: "Attic", hostAddress: "192.168.1.44", isSatellite: false },
];

describe("SonosSelection.vue", () => {
  it("renders the satellite hint with correct text", () => {
    const wrapper = mount(SonosSelection, {
      props: { speakers: speakersFixture },
    });
    const hint = wrapper.find("[data-pi-satellite-hint]");
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toBe("Note: Devices marked with 🛰️ are satellites");
  });

  it("renders options with correct labels and satellite suffix", () => {
    const wrapper = mount(SonosSelection, {
      props: { speakers: speakersFixture },
    });
    const options = wrapper.findAll("option");
    const texts = options.map((o) => o.text());
    expect(texts).toContain("office (192.168.1.42)");
    expect(texts).toContain("Bedroom (192.168.1.43) 🛰️");
    expect(texts).toContain("Attic (192.168.1.44)");
  });

  it("sorts options case‑insensitively by label", () => {
    const wrapper = mount(SonosSelection, {
      props: { speakers: speakersFixture },
    });
    const options = wrapper.findAll("option");
    const texts = options.map((o) => o.text());
    // Expected order: Attic, Bedroom, office
    expect(texts).toEqual(["Attic (192.168.1.44)", "Bedroom (192.168.1.43) 🛰️", "office (192.168.1.42)"]);
  });

  it("filters options by label or UUID (case‑insensitive)", async () => {
    const wrapper = mount(SonosSelection, {
      props: { speakers: speakersFixture },
    });
    const filter = wrapper.find("[data-pi-speaker-filter]");

    // Filter by label fragment "bed"
    await filter.setValue("bed");
    await nextTick();
    let options = wrapper.findAll("option");
    expect(options).toHaveLength(1);
    expect(options[0].text()).toBe("Bedroom (192.168.1.43) 🛰️");

    // Filter by UUID fragment "rincon_ccc" (lowercase)
    await filter.setValue("rincon_ccc");
    await nextTick();
    options = wrapper.findAll("option");
    expect(options).toHaveLength(1);
    expect(options[0].text()).toBe("Attic (192.168.1.44)");

    // Clear filter
    await filter.setValue("");
    await nextTick();
    options = wrapper.findAll("option");
    expect(options).toHaveLength(3);
  });

  it("emits update:modelValue and selection-saved on change", async () => {
    const wrapper = mount(SonosSelection, {
      props: { speakers: speakersFixture },
    });
    const select = wrapper.find("[data-pi-speaker-picker]");
    // Change the selected value
    select.element.value = "RINCON_BBB";
    await select.trigger("change");
    const updateEmits = wrapper.emitted("update:modelValue");
    const savedEmits = wrapper.emitted("selection-saved");
    expect(updateEmits).toBeTruthy();
    expect(savedEmits).toBeTruthy();
    expect(updateEmits[0]).toEqual(["RINCON_BBB"]);
    expect(savedEmits[0]).toEqual(["RINCON_BBB"]);
  });

  it("select has size=5 and reflects the passed modelValue", () => {
    const wrapper = mount(SonosSelection, {
      props: {
        speakers: speakersFixture,
        modelValue: "RINCON_AAA",
      },
    });
    const select = wrapper.find("[data-pi-speaker-picker]");
    expect(select.attributes("size")).toBe("5");
    expect(select.element.value).toBe("RINCON_AAA");
  });
});
