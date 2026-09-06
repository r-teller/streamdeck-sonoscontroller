<script setup>
import { provide } from "vue";

const props = defineProps({
  accordeonId: {
    type: String,
    required: true,
  },
});

provide("accordeonId", props.accordeonId);
</script>

<template>
  <div :id="accordeonId" class="accordion">
    <slot />
  </div>
</template>
