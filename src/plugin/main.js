import { createApp } from "vue";
import { installStreamDeckBridge } from "@/modules/common/sdConnect.js";
import PluginComponent from "@/components/PluginComponent.vue";

// Plugin background entry. Install the bridge synchronously at module load
// so window.connectElgatoStreamDeckSocket exists when Stream Deck calls into
// the page (typically right after page load). The PluginComponent wires up
// the polling supervisor and action dispatch in its onMounted hook.
installStreamDeckBridge();

createApp(PluginComponent).mount("#app");
