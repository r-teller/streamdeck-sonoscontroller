import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "@/scss/styles.scss";
import { createApp } from "vue";
import PiComponent from "@/components/PiComponent.vue";
import { installStreamDeckBridge } from "@/modules/common/sdConnect.js";

installStreamDeckBridge();

createApp(PiComponent).mount("#app");
