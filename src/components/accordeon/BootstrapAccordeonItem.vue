<template>
  <div class="accordion-item">
    <h2 class="accordion-header" :id="itemId">
      <button
        class="accordion-button"
        :class="{ collapsed: !forceExpanded }"
        type="button"
        data-bs-toggle="collapse"
        :data-bs-target="'#collapse' + itemId"
        :aria-expanded="forceExpanded ? 'true' : 'false'"
        :aria-controls="'collapse' + itemId"
      >
        {{ title }}
      </button>
    </h2>
    <div
      :id="'collapse' + itemId"
      class="accordion-collapse"
      :class="{ show: forceExpanded, collapse: !forceExpanded }"
      :aria-labelledby="itemId"
      :data-bs-parent="'#' + accordeonId"
    >
      <div class="accordion-body">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  accordeonId: {
    type: String,
    required: true,
  },
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
</script>
