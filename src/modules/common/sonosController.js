import { SonosService } from "@/modules/common/sonosService.js";
import { convertXmlToJson } from "@/modules/common/xml.js";

// One controller per Sonos host. Wraps the six UPnP service endpoints so
// downstream code can call e.g. `controller.avTransport.execute("Play", ...)`
// instead of constructing services by hand. Memoizes ZoneGroupState so the
// PI's "Save and Connect" flow can derive both devices and favorites from a
// single topology fetch.

// Property name → service descriptor. Verbatim from backend.md
// §Service endpoints registered. Do not reorder; downstream consumers iterate
// `Object.keys(SERVICES)` to enumerate endpoints.
const SERVICES = Object.freeze({
  audioIn: { name: "AudioIn", baseUrl: "AudioIn/Control" },
  avTransport: { name: "AVTransport", baseUrl: "MediaRenderer/AVTransport/Control" },
  deviceProperties: { name: "DeviceProperties", baseUrl: "DeviceProperties/Control" },
  renderingControl: { name: "RenderingControl", baseUrl: "MediaRenderer/RenderingControl/Control" },
  zoneGroupTopology: { name: "ZoneGroupTopology", baseUrl: "ZoneGroupTopology/Control" },
  contentDirectory: { name: "ContentDirectory", baseUrl: "MediaServer/ContentDirectory/Control" },
});

const DEFAULT_TIMEOUT_SEC = 10;

export class SonosController {
  /**
   * @param {object} [opts]
   * @param {number} [opts.timeoutSec] — Default 10 per prd-what.md §6
   *   `Device Timeout Duration (Actions)`. Sourced from
   *   globalSettings.deviceTimeoutDuration in production; threaded into every
   *   service call without per-call boilerplate.
   */
  constructor({ timeoutSec = DEFAULT_TIMEOUT_SEC } = {}) {
    this.timeoutSec = timeoutSec;
    this.host = null;
    this._zoneGroupStateMemo = null;
    for (const key of Object.keys(SERVICES)) this[key] = null;
  }

  /**
   * Bind this controller to a host and construct the six service endpoints.
   * Returns `this` for chaining (`new SonosController().connect(host)`).
   * Re-binding to a different host clears the topology memo so stale data
   * doesn't leak across speakers.
   */
  connect(host) {
    this.host = host;
    const defaultTimeoutMs = this.timeoutSec * 1000;
    for (const [key, { name, baseUrl }] of Object.entries(SERVICES)) {
      this[key] = new SonosService({ host, name, baseUrl, defaultTimeoutMs });
    }
    this._zoneGroupStateMemo = null;
    return this;
  }

  /**
   * Fetch and parse the speaker's ZoneGroupState XML. Memoized — subsequent
   * calls within the same controller instance return the cached parsed JSON
   * unless `forceRefresh: true` is passed.
   *
   * The Sonos response wraps the topology XML as escaped text inside a
   * `<ZoneGroupState>` element; the SOAP parser unescapes it for us, so we
   * just need to feed the resulting string back through `convertXmlToJson`.
   */
  async getZoneGroupState({ forceRefresh = false } = {}) {
    if (!this.host) {
      throw new Error("SonosController.getZoneGroupState called before connect()");
    }
    if (!forceRefresh && this._zoneGroupStateMemo) {
      return this._zoneGroupStateMemo;
    }
    const response = await this.zoneGroupTopology.execute("GetZoneGroupState");
    const stateXml = response.ZoneGroupState ?? "";
    this._zoneGroupStateMemo = stateXml ? convertXmlToJson(stateXml) : null;
    return this._zoneGroupStateMemo;
  }
}
