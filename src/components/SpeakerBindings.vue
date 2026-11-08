<template>
  <div data-pi-speaker-bindings>
    <h2 class="h6 mb-1">Speaker Bindings</h2>
    <div class="form-text text-muted mb-3">
      Speakers your buttons point at. Replacing a speaker repoints <strong>every</strong> button that uses it, including buttons
      on pages that are not on screen. Button counts only include buttons on screen.
    </div>

    <p v-if="!hasHousehold" class="form-text text-muted" data-pi-bindings-not-connected>
      Save and Connect first to check your speakers.
    </p>
    <p v-else-if="rows.length === 0" class="form-text text-muted" data-pi-bindings-empty>
      No buttons on screen are bound to a speaker.
    </p>

    <template v-else>
      <div
        v-for="row in rows"
        :key="row.uuid"
        class="binding-row"
        :class="{ missing: row.status === 'missing' }"
        :data-pi-binding="row.uuid"
        :data-pi-binding-status="row.status"
      >
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div>{{ row.zoneName }} ({{ row.hostAddress }})</div>
            <div class="rincon">{{ row.uuid }}</div>
          </div>
          <div class="text-end text-nowrap">
            <span class="badge" :class="BADGES[row.status].cls">{{ BADGES[row.status].text }}</span>
            <div class="form-text text-muted mt-0">{{ row.buttons }} button{{ row.buttons === 1 ? "" : "s" }} on screen</div>
          </div>
        </div>

        <div v-if="row.status === 'missing'" class="mt-2">
          <label class="form-label small mb-1">Replace with</label>
          <div class="input-group input-group-sm">
            <select v-model="choices[row.uuid]" class="form-select" :data-pi-replace-select="row.uuid">
              <option v-for="d in deviceOptions" :key="d.uuid" :value="d.uuid">
                {{ deviceLabel(d) }}{{ d.zoneName === row.zoneName && !d.isSatellite ? " · same room" : "" }}
              </option>
            </select>
            <button
              type="button"
              class="btn btn-warning"
              :disabled="!choices[row.uuid]"
              :data-pi-replace-apply="row.uuid"
              @click="emit('replace', { from: row.uuid, to: choices[row.uuid] })"
            >
              Replace
            </button>
          </div>
        </div>
        <div v-else-if="row.target" class="mt-2 small">
          <span class="text-secondary">now uses</span> {{ deviceLabel(row.target) }}
        </div>
      </div>
    </template>

    <div v-if="replacementRows.length > 0" class="mt-3" data-pi-replacements>
      <h3 class="h6 mb-2">Active replacements</h3>
      <ul class="list-group">
        <li
          v-for="r in replacementRows"
          :key="r.from"
          class="list-group-item d-flex justify-content-between align-items-center gap-2"
          :data-pi-replacement="r.from"
        >
          <div class="small">
            {{ r.fromLabel }} <span class="text-secondary">to</span> {{ r.toLabel }}
            <div class="rincon">{{ r.from }} to {{ r.to }}</div>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :data-pi-replacement-undo="r.from"
            @click="emit('undo', { from: r.from })"
          >
            Undo
          </button>
        </li>
      </ul>
      <div class="form-text text-muted">
        Kept in global settings. A button saves the new speaker the next time it appears, after which the replacement is no
        longer needed.
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, watchEffect } from "vue";
import { resolveSpeaker, findRoomSpeaker } from "@/modules/common/speakerResolver.js";

const props = defineProps({
  /** On-screen bindings from the plugin: [{ uuid, zoneName, hostAddress, buttons }] */
  bindings: { type: Array, default: () => [] },
  /** Global settings: { devices, speakerReplacements } */
  globals: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["replace", "undo"]);

const BADGES = {
  online: { text: "Online", cls: "text-bg-success" },
  moved: { text: "New IP", cls: "text-bg-info" },
  replaced: { text: "Replaced", cls: "text-bg-info" },
  room: { text: "Same room", cls: "text-bg-info" },
  missing: { text: "Not found", cls: "text-bg-warning" },
};

const devices = computed(() => props.globals?.devices ?? {});
const hasHousehold = computed(() => Object.keys(devices.value).length > 0);
const deviceOptions = computed(() => Object.values(devices.value).sort((a, b) => deviceLabel(a).localeCompare(deviceLabel(b))));

function deviceLabel(d) {
  return `${d.zoneName} (${d.hostAddress})${d.isSatellite ? " · satellite" : ""}`;
}

const rows = computed(() =>
  props.bindings.map((b) => {
    const r = resolveSpeaker(b, props.globals);
    let status;
    let target = null;
    if (r.source === "device") {
      status = r.hostAddress === b.hostAddress ? "online" : "moved";
      if (status === "moved") target = devices.value[r.uuid];
    } else if (r.source === "replacement") {
      status = "replaced";
      target = devices.value[r.uuid];
    } else if (r.source === "room") {
      status = "room";
      target = devices.value[r.uuid];
    } else {
      status = "missing";
    }
    return { ...b, status, target };
  }),
);

// Preselect the same-room speaker (or the first device) for each missing binding.
const choices = reactive({});
watchEffect(() => {
  for (const row of rows.value) {
    if (row.status !== "missing" || choices[row.uuid]) continue;
    const sameRoom = Object.values(devices.value).find((d) => d.zoneName === row.zoneName && !d.isSatellite);
    const fallback = findRoomSpeaker(row.zoneName, devices.value) ?? sameRoom ?? deviceOptions.value[0];
    if (fallback) choices[row.uuid] = fallback.uuid;
  }
});

const replacementRows = computed(() =>
  Object.entries(props.globals?.speakerReplacements ?? {}).map(([from, to]) => {
    const old = props.bindings.find((b) => b.uuid === from);
    const target = devices.value[to];
    return {
      from,
      to,
      fromLabel: old ? `${old.zoneName} (${old.hostAddress})` : "Removed speaker",
      toLabel: target ? deviceLabel(target) : to,
    };
  }),
);

defineExpose({ rows, choices, replacementRows });
</script>

<style scoped>
.binding-row {
  border: 1px solid var(--bs-border-color);
  border-radius: 0.375rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}
.binding-row.missing {
  border-color: var(--bs-warning-border-subtle);
  background: rgba(255, 193, 7, 0.05);
}
.rincon {
  font-family: var(--bs-font-monospace);
  font-size: 0.75rem;
  color: var(--bs-secondary-color);
  word-break: break-all;
}
</style>
