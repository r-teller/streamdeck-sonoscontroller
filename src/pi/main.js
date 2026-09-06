// NOTE: sdConnect.js bridge installation will be added in a later phase.
// For now, we import Bootstrap JS for side effects ( Collapse, etc. ),
// load styles, and mount a bare Vue app as a placeholder.

import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "@/scss/styles.scss";
import { createApp } from "vue";
import PiComponent from "@/components/PiComponent.vue";

createApp(PiComponent).mount("#app");
