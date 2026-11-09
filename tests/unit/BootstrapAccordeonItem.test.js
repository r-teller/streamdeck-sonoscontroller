// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { h, defineComponent, nextTick } from "vue";

const collapseInstances = vi.hoisted(() => []);
vi.mock("bootstrap", () => ({
  Collapse: class {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.show = vi.fn();
      this.hide = vi.fn();
      this.dispose = vi.fn();
      collapseInstances.push(this);
    }
  },
}));

import BootstrapAccordeon from "@/components/accordeon/BootstrapAccordeon.vue";
import BootstrapAccordeonItem from "@/components/accordeon/BootstrapAccordeonItem.vue";

describe("BootstrapAccordeonItem", () => {
  beforeEach(() => {
    collapseInstances.length = 0;
  });

  const mountItem = (forceExpanded) => {
    return mount(BootstrapAccordeon, {
      props: { accordeonId: "test-acc" },
      slots: {
        default: h(
          BootstrapAccordeonItem,
          {
            itemId: "Foo",
            title: "Foo Title",
            forceExpanded,
          },
          () => "body content",
        ),
      },
    });
  };

  it("first paint collapsed when forceExpanded is false", async () => {
    const wrapper = mountItem(false);
    const button = wrapper.find("button");
    const collapseDiv = wrapper.find("#collapseFoo");

    expect(button.classes()).toContain("collapsed");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(button.attributes("aria-controls")).toBe("collapseFoo");
    expect(button.text()).toBe("Foo Title");

    expect(collapseDiv.attributes("data-bs-parent")).toBe("#test-acc");
    expect(collapseDiv.classes()).not.toContain("show");
  });

  it("first paint expanded when forceExpanded is true", async () => {
    const wrapper = mountItem(true);
    const button = wrapper.find("button");
    const collapseDiv = wrapper.find("#collapseFoo");

    expect(button.classes()).not.toContain("collapsed");
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(collapseDiv.classes()).toContain("show");
  });

  it("creates a Collapse instance with toggle:false on mount", async () => {
    const wrapper = mountItem(false);
    const collapseDiv = wrapper.find("#collapseFoo").element;

    expect(collapseInstances).toHaveLength(1);
    const instance = collapseInstances[0];
    expect(instance.el).toBe(collapseDiv);
    expect(instance.opts.toggle).toBe(false);
  });

  it("updates state on user-driven shown/hidden events", async () => {
    const wrapper = mountItem(false);
    const button = wrapper.find("button");
    const collapseDiv = wrapper.find("#collapseFoo").element;

    // simulate shown event
    collapseDiv.dispatchEvent(new Event("shown.bs.collapse"));
    await nextTick();
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("#collapseFoo").classes()).toContain("show");

    // simulate hidden event
    collapseDiv.dispatchEvent(new Event("hidden.bs.collapse"));
    await nextTick();
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("#collapseFoo").classes()).not.toContain("show");
  });

  it("prop watcher calls show/hide on Collapse instance", async () => {
    const TestHarness = defineComponent({
      components: { BootstrapAccordeon, BootstrapAccordeonItem },
      props: { expanded: { type: Boolean, default: false } },
      template: `
        <BootstrapAccordeon accordeon-id="test-acc">
          <BootstrapAccordeonItem
            item-id="Foo"
            title="Foo Title"
            :force-expanded="expanded"
          >body</BootstrapAccordeonItem>
        </BootstrapAccordeon>
      `,
    });

    const wrapper = mount(TestHarness, { props: { expanded: false } });
    expect(collapseInstances).toHaveLength(1);
    const instance = collapseInstances[0];

    // false -> true
    await wrapper.setProps({ expanded: true });
    await nextTick();
    expect(instance.show).toHaveBeenCalledTimes(1);
    expect(instance.hide).toHaveBeenCalledTimes(0);

    // true -> false
    await wrapper.setProps({ expanded: false });
    await nextTick();
    expect(instance.hide).toHaveBeenCalledTimes(1);
  });

  it("disposes Collapse instance on unmount", async () => {
    const wrapper = mountItem(false);
    const instance = collapseInstances[0];
    wrapper.unmount();
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });
});
