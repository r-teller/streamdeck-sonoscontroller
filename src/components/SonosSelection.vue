<template>
  <div>
    <!-- <label class="form-label" for="sonosSpeaker">Sonos Speaker</label> -->
    <small class="text-muted d-block">Note: Devices marked with 🛰️ are satellites</small>
    <select
      size="5"
      id="sonosSpeaker"
      @change="
        (event) => {
          emit('update:modelValue', event.target.value);
          emit('selection-saved');
        }
      "
      :value="modelValue"
      class="form-select form-select-sm mb-1"
    >
      <option v-for="sonosSpeaker in filteredSonosSpeakers" v-bind:key="sonosSpeaker" :value="sonosSpeaker.uuid" :title="sonosSpeaker?.title" :hostAddress="sonosSpeaker?.hostAddress" :zoneName="sonosSpeaker?.zoneName">
        <!-- <option v-for="{ uuid, hostAddress, zoneName } in filteredSonosSpeakers" :key="uuid" v-bind="{ value: uuid, hostAddress, zoneName, title: uuid }"> -->
        {{ sonosSpeaker.title }}
      </option>
    </select>
    <input type="text" class="form-control form-control-sm" v-model="sonosSpeakerFilter" placeholder="Filter by name or Sonos Speaker ID..." />
  </div>
</template>
<script setup>
import { computed, ref } from "vue";
import { SonosSpeaker } from "@/modules/pi/SonosSpeaker";

const props = defineProps({
  modelValue: {
    required: true,
    type: Object,
    default: () =>
      new SonosSpeaker({
        zoneName: "",
        hostAddress: "",
        uuid: "",
        isSatellite: false,
      }),
  },
  availableSonosSpeakers: {
    required: true,
    type: [], // SonosSpeaker[]
  },
});

const emit = defineEmits(["update:modelValue", "selection-saved"]);

const sonosSpeakerFilter = ref("");

const filteredSonosSpeakers = computed(() => {
  if (!sonosSpeakerFilter.value) {
    return props.availableSonosSpeakers;
  }

  let filterLc = sonosSpeakerFilter.value.toLowerCase();
  return props.availableSonosSpeakers.filter((sonosSpeaker) => {
    let uuidMatches = sonosSpeaker.uuid.toLowerCase().indexOf(filterLc) !== -1;
    let titleMatches = sonosSpeaker.title.toLowerCase().indexOf(filterLc) !== -1;
    return uuidMatches || titleMatches;
  });
});
</script>
