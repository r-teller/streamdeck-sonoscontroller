<template>
  <div>
    <div class="form-text" data-pi-satellite-hint>Note: Devices marked with 🛰️ are satellites</div>
    <select class="form-select" size="5" data-pi-speaker-picker :value="modelValue" @change="onChange">
      <option v-for="s in filteredSpeakers" :key="s.uuid" :value="s.uuid">
        {{ s._label }}
      </option>
    </select>
    <input
      v-model="filterText"
      type="text"
      class="form-control mt-2"
      data-pi-speaker-filter
      placeholder="Filter by name or Sonos Speaker ID..."
    />
  </div>
</template>

<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  speakers: {
    type: Array,
    default: () => [],
    validator: (value) => value.every((entry) => entry && typeof entry === "object" && typeof entry.uuid === "string"),
  },
});

const emit = defineEmits(["update:modelValue", "selection-saved"]);

const filterText = ref("");

const labeledSpeakers = computed(() => {
  const baseLabels = props.speakers.map((speaker) => {
    const baseLabel = `${speaker.zoneName} (${speaker.hostAddress})`;
    return {
      ...speaker,
      _label: baseLabel + (speaker.isSatellite ? " 🛰️" : ""),
    };
  });
  return baseLabels.sort((a, b) => a._label.localeCompare(b._label, undefined, { sensitivity: "base" }));
});

const filteredSpeakers = computed(() => {
  if (!filterText.value.trim()) {
    return labeledSpeakers.value;
  }
  const filter = filterText.value.toLowerCase();
  return labeledSpeakers.value.filter((s) => s._label.toLowerCase().includes(filter) || s.uuid.toLowerCase().includes(filter));
});

function onChange(event) {
  const uuid = event.target.value;
  emit("update:modelValue", uuid);
  emit("selection-saved", uuid);
}
</script>
