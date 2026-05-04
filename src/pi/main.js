import { createApp } from "vue";
import PiComponent from "@/components/PiComponent.vue";
import { installStreamDeckBridge } from "@/modules/common/sdConnect.js";
import "../scss/styles.scss";
// eslint-disable-next-line no-unused-vars
import * as bootstrap from "bootstrap";

// Install the SDK bridge synchronously BEFORE mounting Vue, so
// window.connectElgatoStreamDeckSocket exists when Stream Deck calls into the
// page. PiComponent awaits `streamDeckReady` to wire its event handlers.
installStreamDeckBridge();

createApp(PiComponent).mount("#app");
