<script setup>
import { computed, provide } from "vue";

const props = defineProps({
  accordeonId: { type: String, required: true },
});

provide(
  "accordeonId",
  computed(() => props.accordeonId),
);
</script>

<template>
  <div class="accordion" :id="accordeonId">
    <slot />
  </div>
</template>
