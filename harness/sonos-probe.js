import { SonosController } from "../src/modules/common/sonosController.js";
window.SonosController = SonosController;
window.probeResult = null;
window.probe = async (fn) => {
  const out = document.getElementById("output");
  try {
    const result = await fn(window.SonosController);
    window.probeResult = { ok: true, result };
    out.textContent = JSON.stringify(result, null, 2);
    return window.probeResult;
  } catch (err) {
    window.probeResult = { ok: false, error: err.message };
    out.textContent = err.message;
    return window.probeResult;
  }
};
