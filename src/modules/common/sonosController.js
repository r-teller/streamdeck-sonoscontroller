import { SonosService } from "@/modules/common/sonosService.js";
import { convertXmlToJson, asArray } from "@/modules/common/xml.js";
import { translateSonosError } from "@/modules/common/sonosErrors.js";
import { resolveCoordinator } from "@/modules/common/coordinatorResolver.js";

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

// Per xml.js: a text-only element with no attributes returns as a plain string;
// an element WITH attributes returns as `{_attributes, _text, ...}`. Favorites
// pull both shapes (e.g. `<dc:title>` is a bare string; `<res protocolInfo="…">`
// carries `_text`). Centralize the lookup so the per-field extraction at the
// call site stays readable.
function extractText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value._text ?? "";
  return "";
}

/**
 * Extract `{title, artist, album, albumArtURI}` from the embedded DIDL-Lite
 * `TrackMetaData` payload returned by `AVTransport#GetPositionInfo`. The
 * transport's textContent read has already unescaped the outer entities so
 * `metadataXml` is a normal DIDL-Lite XML string ready for `convertXmlToJson`.
 * Empty / missing fields fall through to `""` rather than `undefined` so the
 * `PlayingInfo` shape (data-model.md §"Shape: PlayingInfo") is always
 * type-stable.
 *
 * `<dc:creator>` carries the artist; `<upnp:album>` the album. Both are
 * Sonos-standard DIDL-Lite tags. Some streams (radio) omit creator/album —
 * `extractText` returns `""` for the missing keys.
 */
function parseTrackMetadata(metadataXml) {
  const empty = { title: "", artist: "", album: "", albumArtURI: "" };
  if (!metadataXml) return empty;
  let didl;
  try {
    didl = convertXmlToJson(metadataXml);
  } catch {
    return empty;
  }
  const item = didl?.item ?? didl;
  return {
    title: extractText(item?.["dc:title"]),
    artist: extractText(item?.["dc:creator"]),
    album: extractText(item?.["upnp:album"]),
    albumArtURI: extractText(item?.["upnp:albumArtURI"]),
  };
}

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
    this.boundUuid = null;
    this._zoneGroupStateMemo = null;
    for (const key of Object.keys(SERVICES)) this[key] = null;
  }

  /**
   * Bind this controller to a host and construct the six service endpoints.
   * Returns `this` for chaining (`new SonosController().connect(host)`).
   * Re-binding to a different host clears the topology memo so stale data
   * doesn't leak across speakers.
   *
   * @param {string} host — IPv4 or hostname of the bound speaker.
   * @param {object} [opts]
   * @param {string} [opts.uuid] — The bound speaker's UUID. Required for
   *   any transport command that routes through the group coordinator
   *   (Play, Pause, Next, Prev, SetAVTransportURI, queue ops, etc. — see
   *   h75.6). The discovery walker (`getDevices`) and favorites browser
   *   (`getFavorites`) do NOT need it because they target the bound
   *   speaker directly.
   */
  connect(host, { uuid } = {}) {
    this.host = host;
    this.boundUuid = uuid ?? null;
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
   * Browse the speaker's saved Sonos favorites (`ObjectID=FV:2`) and return
   * one record per `<item>` per data-model.md §"Shape: Favorite". Powers the
   * PI's "Sonos Favorite(s)" dropdown (prd-what.md §7.3) and the
   * `play-sonos-favorite` action's queueing path (prd-what.md §5.10).
   *
   * The Browse response's `Result` field is a string of DIDL-Lite XML
   * (already unescaped once by the SOAP parser's textContent read). We feed
   * that back through `convertXmlToJson` to extract each `<item>`.
   *
   * The `metadata` field is the raw, single-unescaped DIDL-Lite payload of
   * `<r:resMD>` — passed verbatim back into `setServiceURI` /
   * `AddURIToQueue` later, where the SOAP layer re-escapes it for transport.
   *
   * @returns {Promise<Array<{title:string, uri:string, metadata:string, albumArtURI:string}>>}
   */
  async getFavorites() {
    if (!this.host) {
      throw new Error("SonosController.getFavorites called before connect()");
    }
    try {
      const response = await this.contentDirectory.execute("Browse", {
        ObjectID: "FV:2",
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: 0,
        RequestedCount: 0,
        SortCriteria: "",
      });
      const resultXml = response.Result ?? "";
      if (!resultXml) return [];
      const didl = convertXmlToJson(resultXml);
      // After convertXmlToJson, the root `<DIDL-Lite>` element is unwrapped:
      // `didl.item` is the favorite (or array of favorites).
      return asArray(didl?.item).map((item) => ({
        title: extractText(item?.["dc:title"]),
        uri: extractText(item?.res),
        metadata: extractText(item?.["r:resMD"]),
        albumArtURI: extractText(item?.["upnp:albumArtURI"]),
      }));
    } catch (err) {
      throw translateSonosError(err, {
        op: "get favorites",
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

  /**
   * Walk a parsed `ZoneGroupTopology` and return the host (IP/hostname) for
   * the member or satellite whose UUID matches. Used by transport routing
   * to find the coordinator's address after `resolveCoordinator` returns
   * the coord's UUID. Returns `""` when the UUID isn't present (caller
   * decides whether that's an error — usually it is).
   *
   * Static + topology-as-arg so it's testable without a controller and
   * works against either the live memo or a fixture-loaded topology.
   */
  static getHostByUuid(topology, uuid) {
    if (!topology || !uuid) return "";
    for (const group of asArray(topology.ZoneGroups?.ZoneGroup)) {
      for (const member of asArray(group.ZoneGroupMember)) {
        if (member?._attributes?.UUID === uuid) {
          return SonosController.getDeviceLocation(member);
        }
        for (const satellite of asArray(member.Satellite)) {
          if (satellite?._attributes?.UUID === uuid) {
            return SonosController.getDeviceLocation(satellite);
          }
        }
      }
    }
    return "";
  }

  /**
   * Build a `SonosService` targeted at the COORDINATOR of the bound
   * speaker's group. Used for every transport call that must run against
   * the coordinator (AVTransport.* and ContentDirectory.Browse(Q:0)) per
   * the Sonos protocol — non-coordinators reject those with `701
   * Transition not available`.
   *
   * Per-call construction (no service cache) — keeps the lifecycle simple
   * and means a topology change between calls is reflected on the next
   * call's resolution. The cost is a bit of object allocation; the
   * coordinator-resolution spike (cel) recommended this trade.
   *
   * Throws `SonosError(category=unknown)` when the bound speaker isn't in
   * the current topology (delegated to `resolveCoordinator`).
   *
   * @param {keyof typeof SERVICES} serviceKey — `"avTransport"` or
   *   `"contentDirectory"` — i.e. the SERVICES table key whose URL should
   *   be POSTed to on the coordinator's host.
   * @returns {Promise<SonosService>}
   */
  async _coordServiceFor(serviceKey) {
    if (!this.boundUuid) {
      throw new Error(
        "SonosController: boundUuid not set; pass `uuid` to connect() before issuing coordinator-routed commands",
      );
    }
    const topology = await this.getZoneGroupState();
    const coordUuid = resolveCoordinator(this.boundUuid, topology);
    const coordHost = SonosController.getHostByUuid(topology, coordUuid);
    if (!coordHost) {
      // resolveCoordinator returned a UUID that's not in the topology — this
      // is theoretically impossible (the resolver pulled it FROM the topology)
      // but guard so we surface a translatable error instead of a `new
      // SonosService({host: ""})` that would produce a malformed URL later.
      throw new Error(
        `SonosController: coordinator ${coordUuid} resolved but its host is missing from the topology`,
      );
    }
    const { name, baseUrl } = SERVICES[serviceKey];
    return new SonosService({
      host: coordHost,
      name,
      baseUrl,
      defaultTimeoutMs: this.timeoutSec * 1000,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // h75.6 — per-action SOAP commands.
  //
  // Routing rules (per prd-what.md / backend.md):
  //   - AVTransport.*                    → coordinator
  //   - ContentDirectory.Browse(Q:0)     → coordinator (queue is coord-owned)
  //   - RenderingControl.*               → bound speaker
  //     (volume/mute/bass/treble are per-speaker — group members each have
  //      their own values; the action layer decides whose to set)
  //
  // Every method wraps its catch in `translateSonosError` so the PI surfaces
  // a per-op user-facing message, never a programmer artifact (per h75.7).
  // ─────────────────────────────────────────────────────────────────────

  // --- Transport commands (coordinator-routed) -------------------------

  async play() {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("Play", { InstanceID: 0, Speed: 1 });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("play"));
    }
  }

  async pause() {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("Pause", { InstanceID: 0 });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("pause"));
    }
  }

  async next() {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("Next", { InstanceID: 0 });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("next"));
    }
  }

  async previous() {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("Previous", { InstanceID: 0 });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("previous"));
    }
  }

  async setPlayMode(mode) {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("SetPlayMode", { InstanceID: 0, NewPlayMode: mode });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set play mode"));
    }
  }

  async setAVTransportURI(uri, metadata = "") {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("SetAVTransportURI", {
        InstanceID: 0,
        CurrentURI: uri,
        CurrentURIMetaData: metadata,
      });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set transport URI"));
    }
  }

  async seek(unit, target) {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("Seek", { InstanceID: 0, Unit: unit, Target: target });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("seek"));
    }
  }

  async addURIToQueue(uri, metadata = "") {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("AddURIToQueue", {
        InstanceID: 0,
        EnqueuedURI: uri,
        EnqueuedURIMetaData: metadata,
        DesiredFirstTrackNumberEnqueued: 0,
        EnqueueAsNext: 1,
      });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("add URI to queue"));
    }
  }

  async removeAllTracksFromQueue() {
    try {
      const av = await this._coordServiceFor("avTransport");
      return await av.execute("RemoveAllTracksFromQueue", { InstanceID: 0 });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("clear queue"));
    }
  }

  // --- RenderingControl setters (bound speaker) ------------------------

  async setMute(desired) {
    try {
      return await this.renderingControl.execute("SetMute", {
        InstanceID: 0,
        Channel: "Master",
        DesiredMute: desired ? 1 : 0,
      });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set mute"));
    }
  }

  async setVolume(desired) {
    try {
      return await this.renderingControl.execute("SetVolume", {
        InstanceID: 0,
        Channel: "Master",
        DesiredVolume: desired,
      });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set volume"));
    }
  }

  async setBass(desired) {
    try {
      return await this.renderingControl.execute("SetBass", {
        InstanceID: 0,
        DesiredBass: desired,
      });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set bass"));
    }
  }

  async setTreble(desired) {
    try {
      return await this.renderingControl.execute("SetTreble", {
        InstanceID: 0,
        DesiredTreble: desired,
      });
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set treble"));
    }
  }

  // --- RenderingControl getters (bound speaker) ------------------------

  async getMute() {
    try {
      const r = await this.renderingControl.execute("GetMute", {
        InstanceID: 0,
        Channel: "Master",
      });
      return r.CurrentMute === "1";
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get mute"));
    }
  }

  async getVolume() {
    try {
      const r = await this.renderingControl.execute("GetVolume", {
        InstanceID: 0,
        Channel: "Master",
      });
      return Number.parseInt(r.CurrentVolume ?? "0", 10);
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get volume"));
    }
  }

  async getBass() {
    try {
      const r = await this.renderingControl.execute("GetBass", { InstanceID: 0 });
      return Number.parseInt(r.CurrentBass ?? "0", 10);
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get bass"));
    }
  }

  async getTreble() {
    try {
      const r = await this.renderingControl.execute("GetTreble", { InstanceID: 0 });
      return Number.parseInt(r.CurrentTreble ?? "0", 10);
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get treble"));
    }
  }

  // --- AVTransport getters (coordinator-routed) ------------------------

  async getTransportSettings() {
    try {
      const av = await this._coordServiceFor("avTransport");
      const r = await av.execute("GetTransportSettings", { InstanceID: 0 });
      return { playMode: r.PlayMode ?? "" };
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get transport settings"));
    }
  }

  async getTransportInfo() {
    try {
      const av = await this._coordServiceFor("avTransport");
      const r = await av.execute("GetTransportInfo", { InstanceID: 0 });
      return {
        playbackState: r.CurrentTransportState ?? "",
        currentTransportStatus: r.CurrentTransportStatus ?? "",
        currentSpeed: r.CurrentSpeed ?? "",
      };
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get transport info"));
    }
  }

  /**
   * Get current playback position + the playing track's metadata. Parses
   * the embedded DIDL-Lite `TrackMetaData` so callers receive a
   * `PlayingInfo`-shaped object (data-model.md §"Shape: PlayingInfo")
   * directly, not a raw XML blob.
   */
  async getPositionInfo() {
    try {
      const av = await this._coordServiceFor("avTransport");
      const r = await av.execute("GetPositionInfo", { InstanceID: 0 });
      const meta = parseTrackMetadata(r.TrackMetaData ?? "");
      return {
        track: Number.parseInt(r.Track ?? "0", 10),
        trackDuration: r.TrackDuration ?? "",
        trackURI: r.TrackURI ?? "",
        relTime: r.RelTime ?? "",
        absTime: r.AbsTime ?? "",
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        albumArtURI: meta.albumArtURI,
      };
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get position info"));
    }
  }

  /**
   * Browse the queue of the bound speaker's group (`Q:0`). Returns one
   * record per `<item>` in the same `{title, artist, album, uri,
   * albumArtURI}` shape that data-model.md §"Shape: QueueItem" specifies.
   *
   * @param {object} [opts]
   * @param {number} [opts.startIndex=0]
   * @param {number} [opts.requestedCount=0] — Zero = "all" per Sonos.
   */
  async getQueue({ startIndex = 0, requestedCount = 0 } = {}) {
    try {
      const cd = await this._coordServiceFor("contentDirectory");
      const r = await cd.execute("Browse", {
        ObjectID: "Q:0",
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: startIndex,
        RequestedCount: requestedCount,
        SortCriteria: "",
      });
      const resultXml = r.Result ?? "";
      const list = resultXml
        ? asArray(convertXmlToJson(resultXml)?.item).map((item) => ({
            title: extractText(item?.["dc:title"]),
            artist: extractText(item?.["dc:creator"]),
            album: extractText(item?.["upnp:album"]),
            uri: extractText(item?.res),
            albumArtURI: extractText(item?.["upnp:albumArtURI"]),
          }))
        : [];
      return {
        start: Number.parseInt(r.StartingIndex ?? String(startIndex), 10),
        count: Number.parseInt(r.NumberReturned ?? String(list.length), 10),
        list,
      };
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get queue"));
    }
  }

  // --- Orchestrated transport flows ------------------------------------

  /**
   * Switch the bound speaker's group to a different input source by
   * constructing the next URI as `<prefix>:<COORDINATOR_UUID><suffix>`
   * (verbatim per prd-what.md §5.5) and submitting via
   * `SetAVTransportURI`, then immediately calling `Play`. Used by the
   * Toggle Input Source action. Callers derive `(prefix, suffix)` from
   * `getInputSourceMappings(currentURI)` (h75.5).
   */
  async setLocalTransport(prefix, suffix) {
    try {
      if (!this.boundUuid) {
        throw new Error(
          "SonosController.setLocalTransport: boundUuid required (pass uuid to connect())",
        );
      }
      const topology = await this.getZoneGroupState();
      const coordUuid = resolveCoordinator(this.boundUuid, topology);
      const uri = `${prefix}:${coordUuid}${suffix}`;
      await this.setAVTransportURI(uri);
      await this.play();
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set local transport"));
    }
  }

  /**
   * Submit a Sonos favorite for playback. Branches on the favorite's URI
   * scheme:
   *   - `x-sonosapi-stream:` (radio) — short-circuits to two SOAP calls:
   *     `SetAVTransportURI` (URI + metadata verbatim), then `Play`.
   *   - Anything else (queue-based — Spotify playlist, album, etc.) —
   *     five-step queueing sequence:
   *     `RemoveAllTracksFromQueue` → `AddURIToQueue` →
   *     `SetAVTransportURI(x-rincon-queue:<coord>#0)` →
   *     `Seek(TRACK_NR, "1")` → `Play`.
   *
   * Per backend.md §Per-action SOAP commands → Play Favorite and
   * prd-what.md §5.10. The favorite's `metadata` field is passed verbatim
   * — the SOAP transport's `xmlEscape` re-escapes it on the way out.
   *
   * @param {{uri:string, metadata:string, title?:string, albumArtURI?:string}} favorite
   */
  async setServiceURI(favorite) {
    try {
      const { uri, metadata = "" } = favorite ?? {};
      if (!uri) {
        throw new Error("SonosController.setServiceURI: favorite.uri is required");
      }
      if (uri.startsWith("x-sonosapi-stream:")) {
        await this.setAVTransportURI(uri, metadata);
        await this.play();
        return;
      }
      if (!this.boundUuid) {
        throw new Error(
          "SonosController.setServiceURI: boundUuid required for queue-based favorites (pass uuid to connect())",
        );
      }
      const topology = await this.getZoneGroupState();
      const coordUuid = resolveCoordinator(this.boundUuid, topology);
      await this.removeAllTracksFromQueue();
      await this.addURIToQueue(uri, metadata);
      await this.setAVTransportURI(`x-rincon-queue:${coordUuid}#0`);
      await this.seek("TRACK_NR", "1");
      await this.play();
    } catch (err) {
      throw translateSonosError(err, this._opCtx("set service URI"));
    }
  }

  // --- Internal helpers ------------------------------------------------

  _opCtx(op) {
    return { op, host: this.host, port: 1400, timeoutSec: this.timeoutSec };
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
