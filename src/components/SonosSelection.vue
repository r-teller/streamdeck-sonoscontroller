<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  modelValue: { type: String, default: null },
  speakers: {
    type: Array,
    default: () => [],
    validator: (arr) =>
      arr.every(
        (s) =>
          s &&
          typeof s.uuid === "string" &&
          typeof s.zoneName === "string" &&
          typeof s.hostAddress === "string",
      ),
  },
});

const emit = defineEmits(["update:modelValue", "selection-saved"]);

const filterText = ref("");

function formatLabel(speaker) {
  const base = `${speaker.zoneName} (${speaker.hostAddress})`;
  return speaker.isSatellite ? `${base} 🛰️` : base;
}

const sortedSpeakers = computed(() => {
  return [...props.speakers]
    .map((s) => ({ ...s, _label: formatLabel(s) }))
    .sort((a, b) =>
      a._label.localeCompare(b._label, undefined, { sensitivity: "base" }),
    );
});

const filteredSpeakers = computed(() => {
  const q = filterText.value.trim().toLowerCase();
  if (!q) return sortedSpeakers.value;
  return sortedSpeakers.value.filter(
    (s) =>
      s._label.toLowerCase().includes(q) || s.uuid.toLowerCase().includes(q),
  );
});

function onChange(event) {
  const newUuid = event.target.value;
  emit("update:modelValue", newUuid);
  emit("selection-saved", newUuid);
}
</script>

<template>
  <div class="sonos-selection">
    <p class="text-muted small mb-1" data-pi-satellite-hint>
      Note: Devices marked with 🛰️ are satellites
    </p>
    <select
      class="form-select"
      size="5"
      :value="modelValue"
      data-pi-speaker-picker
      @change="onChange"
    >
      <option
        v-for="speaker in filteredSpeakers"
        :key="speaker.uuid"
        :value="speaker.uuid"
      >
        {{ speaker._label }}
      </option>
    </select>
    <input
      v-model="filterText"
      type="text"
      class="form-control mt-2"
      placeholder="Filter by name or Sonos Speaker ID..."
      data-pi-speaker-filter
    />
  </div>
</template>
