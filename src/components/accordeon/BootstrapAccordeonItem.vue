<script setup>
import { ref, watch, computed, inject, onMounted, onBeforeUnmount } from "vue";
import { Collapse } from "bootstrap";

const props = defineProps({
  itemId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  forceExpanded: {
    type: Boolean,
    default: false,
  },
});

const accordeonId = inject("accordeonId");
const expanded = ref(props.forceExpanded);
const collapseEl = ref(null);
let collapseInstance = null;

const collapseId = computed(() => `collapse${props.itemId}`);

const onShown = () => {
  expanded.value = true;
};

const onHidden = () => {
  expanded.value = false;
};

watch(
  () => props.forceExpanded,
  (v) => {
    if (!collapseInstance) return;
    if (v) {
      collapseInstance.show();
    } else {
      collapseInstance.hide();
    }
  },
);

onMounted(() => {
  collapseInstance = new Collapse(collapseEl.value, { toggle: false });

  collapseEl.value.addEventListener("shown.bs.collapse", onShown);
  collapseEl.value.addEventListener("hidden.bs.collapse", onHidden);
});

onBeforeUnmount(() => {
  if (collapseEl.value) {
    collapseEl.value.removeEventListener("shown.bs.collapse", onShown);
    collapseEl.value.removeEventListener("hidden.bs.collapse", onHidden);
  }
  if (collapseInstance) {
    collapseInstance.dispose();
  }
});
</script>

<template>
  <div class="accordion-item">
    <h2 class="accordion-header">
      <button
        type="button"
        class="accordion-button"
        :class="{ collapsed: !expanded }"
        data-bs-toggle="collapse"
        :data-bs-target="`#${collapseId}`"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="collapseId"
      >
        {{ title }}
      </button>
    </h2>
    <div
      :id="collapseId"
      ref="collapseEl"
      class="accordion-collapse collapse"
      :class="{ show: expanded }"
      :data-bs-parent="`#${accordeonId}`"
    >
      <div class="accordion-body">
        <slot />
      </div>
    </div>
  </div>
</template>
