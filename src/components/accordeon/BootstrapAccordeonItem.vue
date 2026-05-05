<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Collapse } from "bootstrap";

const props = defineProps({
  itemId: { type: String, required: true },
  title: { type: String, required: true },
  forceExpanded: { type: Boolean, default: false },
});

const accordeonId = inject("accordeonId", null);
const collapseId = computed(() => "collapse" + props.itemId);
const parentSelector = computed(() => {
  const id = accordeonId?.value ?? accordeonId;
  return id ? "#" + id : null;
});

const collapseEl = ref(null);
const isExpanded = ref(props.forceExpanded);
let collapseInstance = null;

function handleShown() {
  isExpanded.value = true;
}
function handleHidden() {
  isExpanded.value = false;
}

onMounted(() => {
  if (!collapseEl.value) return;
  collapseInstance = new Collapse(collapseEl.value, { toggle: false });
  collapseEl.value.addEventListener("shown.bs.collapse", handleShown);
  collapseEl.value.addEventListener("hidden.bs.collapse", handleHidden);
});

onBeforeUnmount(() => {
  if (collapseEl.value) {
    collapseEl.value.removeEventListener("shown.bs.collapse", handleShown);
    collapseEl.value.removeEventListener("hidden.bs.collapse", handleHidden);
  }
  collapseInstance?.dispose();
  collapseInstance = null;
});

watch(
  () => props.forceExpanded,
  (next) => {
    isExpanded.value = next;
    if (!collapseInstance) return;
    if (next) collapseInstance.show();
    else collapseInstance.hide();
  },
);
</script>

<template>
  <div class="accordion-item">
    <h2 class="accordion-header">
      <button
        :class="['accordion-button', { collapsed: !isExpanded }]"
        type="button"
        data-bs-toggle="collapse"
        :data-bs-target="'#' + collapseId"
        :aria-expanded="isExpanded ? 'true' : 'false'"
        :aria-controls="collapseId"
      >
        {{ title }}
      </button>
    </h2>
    <div
      :id="collapseId"
      ref="collapseEl"
      :class="['accordion-collapse', 'collapse', { show: isExpanded }]"
      :data-bs-parent="parentSelector"
    >
      <div class="accordion-body">
        <slot />
      </div>
    </div>
  </div>
</template>
