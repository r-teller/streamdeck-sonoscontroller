// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import BootstrapAccordeon from "@/components/accordeon/BootstrapAccordeon.vue";
import BootstrapAccordeonItem from "@/components/accordeon/BootstrapAccordeonItem.vue";

function mountItem(props = {}, accordeonId = "testAccordeon") {
  return mount(BootstrapAccordeon, {
    props: { accordeonId },
    slots: {
      default: () =>
        h(BootstrapAccordeonItem, {
          itemId: "MyItem",
          title: "Section Title",
          forceExpanded: false,
          ...props,
        }),
    },
    attachTo: document.body,
  });
}

import { h } from "vue";

describe("BootstrapAccordeonItem — first paint (orw.2 AC#1, AC#2)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("AC#1: forceExpanded={true} renders open on first paint", () => {
    const wrapper = mountItem({ forceExpanded: true });
    const collapse = wrapper.find(".accordion-collapse");
    const button = wrapper.find(".accordion-button");

    expect(collapse.classes()).toContain("show");
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(button.classes()).not.toContain("collapsed");
  });

  it("AC#2: forceExpanded={false} renders collapsed on first paint", () => {
    const wrapper = mountItem({ forceExpanded: false });
    const collapse = wrapper.find(".accordion-collapse");
    const button = wrapper.find(".accordion-button");

    expect(collapse.classes()).not.toContain("show");
    expect(collapse.classes()).toContain("collapse");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(button.classes()).toContain("collapsed");
  });
});

describe("BootstrapAccordeonItem — id composition (orw.2 AC#4)", () => {
  it("AC#4: collapse target id = 'collapse' + itemId", () => {
    const wrapper = mountItem({ itemId: "GlobalSettings" });
    const collapse = wrapper.find(".accordion-collapse");
    const button = wrapper.find(".accordion-button");

    expect(collapse.attributes("id")).toBe("collapseGlobalSettings");
    expect(button.attributes("data-bs-target")).toBe("#collapseGlobalSettings");
    expect(button.attributes("aria-controls")).toBe("collapseGlobalSettings");
  });

  it("AC#4: data-bs-parent = '#' + accordeonId from parent provider", () => {
    const wrapper = mountItem({}, "myParentAccordeon");
    const collapse = wrapper.find(".accordion-collapse");
    expect(collapse.attributes("data-bs-parent")).toBe("#myParentAccordeon");
  });
});

describe("BootstrapAccordeonItem — header label (orw.2 AC#6)", () => {
  it("AC#6: button text = title prop verbatim", () => {
    const wrapper = mountItem({ title: "Available Sonos Speakers" });
    expect(wrapper.find(".accordion-button").text()).toBe(
      "Available Sonos Speakers",
    );
  });

  it("AC#6: title 'Global Settings' renders verbatim", () => {
    const wrapper = mountItem({ title: "Global Settings" });
    expect(wrapper.find(".accordion-button").text()).toBe("Global Settings");
  });
});

describe("BootstrapAccordeonItem — aria-expanded tracks show class (orw.2 AC#5)", () => {
  it("AC#5: aria-expanded='true' iff body has 'show' class (forceExpanded=true)", () => {
    const wrapper = mountItem({ forceExpanded: true });
    const collapse = wrapper.find(".accordion-collapse");
    const button = wrapper.find(".accordion-button");
    expect(collapse.classes()).toContain("show");
    expect(button.attributes("aria-expanded")).toBe("true");
  });

  it("AC#5: aria-expanded='false' iff body lacks 'show' class (forceExpanded=false)", () => {
    const wrapper = mountItem({ forceExpanded: false });
    const collapse = wrapper.find(".accordion-collapse");
    const button = wrapper.find(".accordion-button");
    expect(collapse.classes()).not.toContain("show");
    expect(button.attributes("aria-expanded")).toBe("false");
  });
});

describe("BootstrapAccordeonItem — slot content", () => {
  it("renders default slot content into accordion-body", () => {
    const wrapper = mount(BootstrapAccordeon, {
      props: { accordeonId: "x" },
      slots: {
        default: () =>
          h(
            BootstrapAccordeonItem,
            { itemId: "x", title: "T", forceExpanded: false },
            {
              default: () => h("p", { class: "slot-marker" }, "body content"),
            },
          ),
      },
      attachTo: document.body,
    });
    const body = wrapper.find(".accordion-body");
    expect(body.find(".slot-marker").text()).toBe("body content");
  });
});

describe("BootstrapAccordeonItem — user click toggles regardless of prop (orw.2 AC#3)", () => {
  it("AC#3: shown.bs.collapse event flips aria-expanded to true (simulates user opening)", async () => {
    const wrapper = mountItem({ forceExpanded: false });
    const collapse = wrapper.find(".accordion-collapse");

    // Simulate Bootstrap firing shown.bs.collapse after user click.
    // (jsdom doesn't run Bootstrap's CSS transition; the component listens
    // to the event regardless of how it was triggered.)
    collapse.element.dispatchEvent(
      new Event("shown.bs.collapse", { bubbles: false }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".accordion-button").attributes("aria-expanded")).toBe(
      "true",
    );
    expect(wrapper.find(".accordion-collapse").classes()).toContain("show");
  });

  it("AC#3: hidden.bs.collapse event flips aria-expanded to false (simulates user closing)", async () => {
    const wrapper = mountItem({ forceExpanded: true });
    const collapse = wrapper.find(".accordion-collapse");

    collapse.element.dispatchEvent(
      new Event("hidden.bs.collapse", { bubbles: false }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".accordion-button").attributes("aria-expanded")).toBe(
      "false",
    );
    expect(wrapper.find(".accordion-collapse").classes()).not.toContain("show");
  });
});
