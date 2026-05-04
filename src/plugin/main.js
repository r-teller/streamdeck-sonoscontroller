import { createApp } from "vue";
import { installStreamDeckBridge } from "@/modules/common/sdConnect.js";

// Plugin background entry. Install the bridge synchronously at module load
// so window.connectElgatoStreamDeckSocket exists when Stream Deck calls into
// the page (typically right after page load). Phase 3 (etr.*) attaches the
// action dispatcher and polling supervisor by awaiting `streamDeckReady`.
installStreamDeckBridge();

const Placeholder = { render: () => null };
createApp(Placeholder).mount("#app");
