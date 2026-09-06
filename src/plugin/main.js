import { createApp } from "vue";
import PluginComponent from "@/components/PluginComponent.vue";
import { installStreamDeckBridge } from "@/modules/common/sdConnect.js";

installStreamDeckBridge();

createApp(PluginComponent).mount("#app");
