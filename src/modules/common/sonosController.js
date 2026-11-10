import { SONOS_SERVICES, SonosService } from "./sonosService.js";
import { convertXmlToJson, asArray, extractText } from "./xml.js";
import { translateSonosError } from "./sonosErrors.js";
import { resolveCoordinator } from "./coordinatorResolver.js";

export class SonosController {
  constructor({ timeoutSec = 10 } = {}) {
    this.timeoutSec = timeoutSec;
    this.host = null;
    this.boundUuid = null;
    this.services = null;
    this._zoneGroupStateCache = null;
  }

  connect(host, { uuid } = {}) {
    this.host = host;
    this.boundUuid = uuid ?? null;

    const timeoutMs = this.timeoutSec * 1000;
    this.services = {
      avTransport: new SonosService({
        host,
        ...SONOS_SERVICES.avTransport,
        defaultTimeoutMs: timeoutMs,
      }),
      renderingControl: new SonosService({
        host,
        ...SONOS_SERVICES.renderingControl,
        defaultTimeoutMs: timeoutMs,
      }),
      zoneGroupTopology: new SonosService({
        host,
        ...SONOS_SERVICES.zoneGroupTopology,
        defaultTimeoutMs: timeoutMs,
      }),
      contentDirectory: new SonosService({
        host,
        ...SONOS_SERVICES.contentDirectory,
        defaultTimeoutMs: timeoutMs,
      }),
      deviceProperties: new SonosService({
        host,
        ...SONOS_SERVICES.deviceProperties,
        defaultTimeoutMs: timeoutMs,
      }),
      audioIn: new SonosService({
        host,
        ...SONOS_SERVICES.audioIn,
        defaultTimeoutMs: timeoutMs,
      }),
    };

    // Reset memoized zone group state
    this._zoneGroupStateCache = null;

    return this;
  }

  async _topology({ forceRefresh = false } = {}) {
    if (!forceRefresh && this._zoneGroupStateCache !== null) {
      return this._zoneGroupStateCache;
    }

    const response = await this.services.zoneGroupTopology.execute("GetZoneGroupState");
    const rawState = response.ZoneGroupState;

    if (!rawState) {
      this._zoneGroupStateCache = null;
      return null;
    }

    // Double-parse: first by SOAP layer (unescaped once), now via convertXmlToJson
    const parsed = convertXmlToJson(rawState);
    this._zoneGroupStateCache = parsed;

    return parsed;
  }

  async getZoneGroupState({ forceRefresh = false } = {}) {
    try {
      return await this._topology({ forceRefresh });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get zone group state"));
      throw translated;
    }
  }

  static getDeviceLocation(member) {
    const location = member?._attributes?.Location ?? "";
    const match = location.match(/^https?:\/\/([^:/]+)/);
    return match ? match[1] : null;
  }

  static getHostByUuid(topology, uuid) {
    if (!topology?.ZoneGroups?.ZoneGroup) return null;

    for (const group of asArray(topology.ZoneGroups.ZoneGroup)) {
      const members = asArray(group.ZoneGroupMember);
      for (const member of members) {
        if (member?._attributes?.UUID === uuid) {
          return SonosController.getDeviceLocation(member);
        }

        // Check satellites
        const satellites = asArray(member.Satellite);
        for (const satellite of satellites) {
          if (satellite?._attributes?.UUID === uuid) {
            return SonosController.getDeviceLocation(satellite);
          }
        }
      }
    }

    return null;
  }

  async _coordServiceFor(serviceKey) {
    if (!this.boundUuid) {
      throw new Error("boundUuid is required for coordinator routing");
    }

    const topology = await this._topology();
    const coordUuid = resolveCoordinator(this.boundUuid, topology);
    const coordHost = SonosController.getHostByUuid(topology, coordUuid);

    if (!coordHost) {
      throw new Error(`Coordinator host not found for UUID: ${coordUuid}`);
    }

    const service = new SonosService({
      host: coordHost,
      ...SONOS_SERVICES[serviceKey],
      defaultTimeoutMs: this.timeoutSec * 1000,
    });

    return { service, coordUuid, coordHost };
  }

  _opCtx(op) {
    return {
      op,
      host: this.host,
      port: 1400,
      timeoutSec: this.timeoutSec,
    };
  }

  async getDevices({ setAsPrimary = false } = {}) {
    try {
      const topology = await this._topology();
      const devices = [];

      for (const group of asArray(topology?.ZoneGroups?.ZoneGroup)) {
        const members = asArray(group.ZoneGroupMember);
        for (const member of members) {
          const hostAddress = SonosController.getDeviceLocation(member);
          const uuid = member?._attributes?.UUID ?? "";
          const zoneName = member?._attributes?.ZoneName ?? "";

          const isPrimary = setAsPrimary && hostAddress === this.host;

          devices.push({
            primary: isPrimary,
            hostAddress,
            port: 1400,
            zoneName,
            isSatellite: false,
            idleState: "ACTIVE",
            uuid,
          });

          // Add satellites
          const satellites = asArray(member.Satellite);
          for (const satellite of satellites) {
            const satHostAddress = SonosController.getDeviceLocation(satellite);
            const satUuid = satellite?._attributes?.UUID ?? "";
            const satZoneName = satellite?._attributes?.ZoneName ?? "";

            const isSatPrimary = setAsPrimary && satHostAddress === this.host;

            devices.push({
              primary: isSatPrimary,
              hostAddress: satHostAddress,
              port: 1400,
              zoneName: satZoneName,
              isSatellite: true,
              idleState: "ACTIVE",
              uuid: satUuid,
            });
          }
        }
      }

      return devices;
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get devices"));
    }
  }

  async getFavorites() {
    try {
      const response = await this.services.contentDirectory.execute("Browse", {
        ObjectID: "FV:2",
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: 0,
        RequestedCount: 0,
        SortCriteria: "",
      });

      const result = response.Result;
      if (!result) {
        return [];
      }

      const didl = convertXmlToJson(result);
      const items = asArray(didl.item);
      const favorites = [];

      for (const item of items) {
        favorites.push({
          title: extractText(item["dc:title"]),
          uri: extractText(item.res),
          metadata: extractText(item["r:resMD"]),
          albumArtURI: this.absoluteArtURI(extractText(item["upnp:albumArtURI"])),
        });
      }

      return favorites;
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get favorites"));
      throw translated;
    }
  }

  // === PART 2: transport/rendering getters+setters, getQueue, setLocalTransport, setServiceURI ===

  // Transport methods (coordinator-routed via avTransport)
  async play() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("Play", { InstanceID: 0, Speed: 1 });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("play"));
      throw translated;
    }
  }

  async pause() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("Pause", { InstanceID: 0 });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("pause"));
      throw translated;
    }
  }

  async next() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("Next", { InstanceID: 0 });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("next"));
      throw translated;
    }
  }

  async previous() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("Previous", { InstanceID: 0 });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("previous"));
      throw translated;
    }
  }

  async setPlayMode(mode) {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("SetPlayMode", { InstanceID: 0, NewPlayMode: mode });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set play mode"));
      throw translated;
    }
  }

  async setAVTransportURI(uri, metadata = "") {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("SetAVTransportURI", {
        InstanceID: 0,
        CurrentURI: uri,
        CurrentURIMetaData: metadata,
      });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set transport URI"));
      throw translated;
    }
  }

  async seek(unit, target) {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("Seek", { InstanceID: 0, Unit: unit, Target: target });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("seek"));
      throw translated;
    }
  }

  async addURIToQueue(uri, metadata = "") {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("AddURIToQueue", {
        InstanceID: 0,
        EnqueuedURI: uri,
        EnqueuedURIMetaData: metadata,
        DesiredFirstTrackNumberEnqueued: 0,
        EnqueueAsNext: 1,
      });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("add URI to queue"));
      throw translated;
    }
  }

  async removeAllTracksFromQueue() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      await service.execute("RemoveAllTracksFromQueue", { InstanceID: 0 });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("remove all tracks from queue"));
      throw translated;
    }
  }

  // Rendering setters (bound speaker via renderingControl)
  async setMute(muted) {
    try {
      await this.services.renderingControl.execute("SetMute", {
        InstanceID: 0,
        Channel: "Master",
        DesiredMute: muted ? 1 : 0,
      });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set mute"));
      throw translated;
    }
  }

  async setVolume(volume) {
    try {
      await this.services.renderingControl.execute("SetVolume", {
        InstanceID: 0,
        Channel: "Master",
        DesiredVolume: volume,
      });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set volume"));
      throw translated;
    }
  }

  async setBass(bass) {
    try {
      await this.services.renderingControl.execute("SetBass", {
        InstanceID: 0,
        DesiredBass: bass,
      });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set bass"));
      throw translated;
    }
  }

  async setTreble(treble) {
    try {
      await this.services.renderingControl.execute("SetTreble", {
        InstanceID: 0,
        DesiredTreble: treble,
      });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set treble"));
      throw translated;
    }
  }

  // Rendering getters (bound speaker via renderingControl)
  async getMute() {
    try {
      const response = await this.services.renderingControl.execute("GetMute", {
        InstanceID: 0,
        Channel: "Master",
      });
      return response.CurrentMute === "1";
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get mute"));
      throw translated;
    }
  }

  async getVolume() {
    try {
      const response = await this.services.renderingControl.execute("GetVolume", {
        InstanceID: 0,
        Channel: "Master",
      });
      return parseInt(response.CurrentVolume ?? "0", 10);
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get volume"));
      throw translated;
    }
  }

  async getBass() {
    try {
      const response = await this.services.renderingControl.execute("GetBass", {
        InstanceID: 0,
      });
      return parseInt(response.CurrentBass ?? "0", 10);
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get bass"));
      throw translated;
    }
  }

  async getTreble() {
    try {
      const response = await this.services.renderingControl.execute("GetTreble", {
        InstanceID: 0,
      });
      return parseInt(response.CurrentTreble ?? "0", 10);
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get treble"));
      throw translated;
    }
  }

  // Transport getters (coordinator-routed via avTransport)
  async getTransportSettings() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      const response = await service.execute("GetTransportSettings", { InstanceID: 0 });
      return { playMode: response.PlayMode ?? "" };
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get transport settings"));
      throw translated;
    }
  }

  async getTransportInfo() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      const response = await service.execute("GetTransportInfo", { InstanceID: 0 });
      return {
        // Sonos reports TRANSITIONING for a moment after Play (and on track changes); it is on its way
        // to playing, so surface it as PLAYING rather than letting callers treat it as paused.
        playbackState: response.CurrentTransportState === "TRANSITIONING" ? "PLAYING" : (response.CurrentTransportState ?? ""),
        currentTransportStatus: response.CurrentTransportStatus ?? "",
        currentSpeed: response.CurrentSpeed ?? "",
      };
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get transport info"));
      throw translated;
    }
  }

  async getPositionInfo() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      const response = await service.execute("GetPositionInfo", { InstanceID: 0 });

      // Queue position (1-based); 0 when absent or non-numeric (e.g. radio).
      const track = parseInt(response.Track ?? "0", 10) || 0;
      const trackDuration = response.TrackDuration ?? "";
      const trackURI = response.TrackURI ?? "";
      const relTime = response.RelTime ?? "";
      const absTime = response.AbsTime ?? "";

      let title = "",
        artist = "",
        album = "",
        albumArtURI = "";

      const trackMetaData = response.TrackMetaData;
      if (trackMetaData && trackMetaData !== "NOT_IMPLEMENTED") {
        // Some sources (radio streams, third-party services) send malformed DIDL. The track metadata is
        // cosmetic, so a bad blob degrades to empty fields rather than failing the whole poll (sonos-9b0).
        let item;
        try {
          item = asArray(convertXmlToJson(trackMetaData).item)[0];
        } catch {
          item = undefined;
        }
        if (item) {
          title = extractText(item["dc:title"]);
          artist = extractText(item["dc:creator"]);
          album = extractText(item["upnp:album"]);
          albumArtURI = this.absoluteArtURI(extractText(item["upnp:albumArtURI"]));
        }
      }

      return { track, trackDuration, trackURI, relTime, absTime, title, artist, album, albumArtURI };
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get position info"));
      throw translated;
    }
  }

  /**
   * Sonos reports track art as a speaker-relative path ("/getaa?s=1&u=..."). Resolve it against
   * this speaker so it can be fetched (restores 1.0.2.5 behaviour, sonos-clg).
   * @param {string} uri
   * @returns {string}
   */
  absoluteArtURI(uri) {
    if (!uri || /^https?:\/\//i.test(uri) || !uri.startsWith("/") || !this.host) return uri ?? "";
    return `http://${this.host}:1400${uri}`;
  }

  /**
   * The transport's current source: "x-rincon-queue:<uuid>#0" for queue playback, otherwise the
   * stream/input URI (radio, TV, line-in).
   * @returns {Promise<{currentURI: string}>}
   */
  async getMediaInfo() {
    try {
      const { service } = await this._coordServiceFor("avTransport");
      const response = await service.execute("GetMediaInfo", { InstanceID: 0 });
      return { currentURI: response.CurrentURI ?? "" };
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get media info"));
    }
  }

  /**
   * Identifies the queue's current contents: version counter, size and first track. Changes when the
   * queue is cleared, replaced or edited; unaffected by shuffle, seek or play/pause (sonos-gw5).
   * @returns {Promise<{updateId: string, total: number, firstTrackUri: string}>}
   */
  async getQueueSignature() {
    try {
      const { service } = await this._coordServiceFor("contentDirectory");
      const response = await service.execute("Browse", {
        ObjectID: "Q:0",
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: 0,
        RequestedCount: 1,
        SortCriteria: "",
      });
      let firstTrackUri = "";
      if (response.Result) {
        const first = asArray(convertXmlToJson(response.Result).item)[0];
        if (first) firstTrackUri = extractText(first.res);
      }
      return {
        updateId: String(response.UpdateID ?? ""),
        total: parseInt(response.TotalMatches ?? "0", 10),
        firstTrackUri,
      };
    } catch (err) {
      throw translateSonosError(err, this._opCtx("get queue signature"));
    }
  }

  // Queue (coordinator-routed via contentDirectory)
  async getQueue({ startIndex = 0, requestedCount = 0 } = {}) {
    try {
      const { service } = await this._coordServiceFor("contentDirectory");
      const response = await service.execute("Browse", {
        ObjectID: "Q:0",
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: startIndex,
        RequestedCount: requestedCount,
        SortCriteria: "",
      });

      const result = response.Result ?? "";
      let list = [];

      if (result) {
        const didl = convertXmlToJson(result);
        const items = asArray(didl.item);
        list = items.map((item) => ({
          title: extractText(item["dc:title"]),
          artist: extractText(item["dc:creator"]),
          album: extractText(item["upnp:album"]),
          uri: extractText(item.res),
          albumArtURI: this.absoluteArtURI(extractText(item["upnp:albumArtURI"])),
        }));
      }

      return {
        start: startIndex,
        count: parseInt(response.NumberReturned ?? "0", 10),
        list,
      };
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("get queue"));
      throw translated;
    }
  }

  // Orchestrations
  async setLocalTransport(prefix, suffix) {
    try {
      const { service, coordUuid } = await this._coordServiceFor("avTransport");
      const uri = `${prefix}:${coordUuid}${suffix}`;
      await service.execute("SetAVTransportURI", {
        InstanceID: 0,
        CurrentURI: uri,
        CurrentURIMetaData: "",
      });
      await service.execute("Play", { InstanceID: 0, Speed: 1 });
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set local transport"));
      throw translated;
    }
  }

  async setServiceURI(favorite) {
    try {
      if (!favorite?.uri) {
        throw new Error("favorite.uri is required");
      }

      const { service, coordUuid } = await this._coordServiceFor("avTransport");

      if (favorite.uri.startsWith("x-sonosapi-stream:")) {
        // Radio branch: 2 calls
        await service.execute("SetAVTransportURI", {
          InstanceID: 0,
          CurrentURI: favorite.uri,
          CurrentURIMetaData: favorite.metadata ?? "",
        });
        await service.execute("Play", { InstanceID: 0, Speed: 1 });
      } else {
        // Queue branch: 5 calls
        await service.execute("RemoveAllTracksFromQueue", { InstanceID: 0 });
        await service.execute("AddURIToQueue", {
          InstanceID: 0,
          EnqueuedURI: favorite.uri,
          EnqueuedURIMetaData: favorite.metadata ?? "",
          DesiredFirstTrackNumberEnqueued: 0,
          EnqueueAsNext: 1,
        });
        await service.execute("SetAVTransportURI", {
          InstanceID: 0,
          CurrentURI: `x-rincon-queue:${coordUuid}#0`,
          CurrentURIMetaData: "",
        });
        await service.execute("Seek", { InstanceID: 0, Unit: "TRACK_NR", Target: "1" });
        await service.execute("Play", { InstanceID: 0, Speed: 1 });
      }
    } catch (err) {
      const translated = translateSonosError(err, this._opCtx("set service URI"));
      throw translated;
    }
  }
}
