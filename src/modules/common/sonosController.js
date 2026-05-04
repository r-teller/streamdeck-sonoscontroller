import { SonosService } from "@/modules/common/sonosService.js";
import { convertXmlToJson, asArray } from "@/modules/common/xml.js";
import { translateSonosError } from "@/modules/common/sonosErrors.js";

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

  /**
   * Walk the speaker household topology and return one DeviceRecord per
   * playable member (per data-model.md §"Shape: DeviceRecord"). Includes
   * satellites (sub, surround pair) flagged with `isSatellite: true`.
   *
   * Every iteration over ZoneGroup, ZoneGroupMember, and Satellite goes
   * through `asArray` — the discipline that prevents the prd-what.md §3.3
   * regression where a one-element household surfaces as
   * `<name> is not iterable` and blocks setup.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.setAsPrimary] — When true, the member whose host
   *   matches `this.host` gets `primary: true`. Otherwise no record is
   *   marked primary.
   * @returns {Promise<DeviceRecord[]>}
   */
  async getDevices({ setAsPrimary = false } = {}) {
    try {
      const topology = await this.getZoneGroupState();
      if (!topology) return [];
      const result = [];
      for (const group of asArray(topology.ZoneGroups?.ZoneGroup)) {
        for (const member of asArray(group.ZoneGroupMember)) {
          result.push(this._memberToRecord(member, false, setAsPrimary));
          for (const satellite of asArray(member.Satellite)) {
            result.push(this._memberToRecord(satellite, true, setAsPrimary));
          }
        }
      }
      return result;
    } catch (err) {
      throw translateSonosError(err, {
        op: "get devices",
        host: this.host,
        port: 1400,
        timeoutSec: this.timeoutSec,
      });
    }
  }

  /**
   * Extract the host portion of a ZoneGroupMember's `Location` URL
   * (e.g. "http://192.168.1.42:1400/xml/device_description.xml" →
   * "192.168.1.42"). Returns "" if the member has no parseable Location.
   * Static so callers without a SonosController instance can still use it.
   */
  static getDeviceLocation(member) {
    const location = member?._attributes?.Location ?? "";
    const match = location.match(/^https?:\/\/([^:/]+)/);
    return match?.[1] ?? "";
  }

  _memberToRecord(member, isSatellite, setAsPrimary) {
    const attrs = member?._attributes ?? {};
    const hostAddress = SonosController.getDeviceLocation(member);
    return {
      primary: Boolean(setAsPrimary) && hostAddress === this.host,
      hostAddress,
      port: 1400,
      zoneName: attrs.ZoneName ?? "",
      isSatellite,
      idleState: "ACTIVE",
      uuid: attrs.UUID ?? "",
    };
  }
}
