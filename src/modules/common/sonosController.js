export class SonosController {
  static BROWSE_TYPE = {
    ARTISTS: "A:ARTIST",
    ARTIST_ALBUMS: "A:ALBUMARTIST",
    ALBUMS: "A:ALBUM",
    GENRES: "A:GENRE",
    COMPOSERS: "A:COMPOSER",
    TRACKS: "A:TRACKS",
    PLAYLISTS: "A:PLAYLISTS",
    SHARES: "S:",
    SONOS_PLAYLISTS: "SQ:",
    CATEGORIES: "A:",
    SONOS_FAVORITES: "FV:2",
    RADIO_STATIONS: "R:0/0",
    RADIO_SHOWS: "R:0/1",
  };

  // Track URI Examples from getPositionInfo
  // Spotify:
  // -- prefix: x-sonos-spotify
  // -- example: x-sonos-spotify:spotify:track:5Exmd44HuT5LCp2NqYjsM5?sid=12&flags=8224&sn=7
  // TV:
  // -- prefix: x-sonos-htastream
  // -- example: x-sonos-htastream:RINCON_542A1B838E8301400:spdif
  // Sonos Radio:
  // -- prefix: x-sonos-http
  // -- example: "x-sonos-http:sonos:a78b8e1eb3318dd09f0bb529deed153d-DZR:26:1730662302290:head:2997::dzrs.trk.2947516331:default:SD.mp4?sid=303&flags=0&sn=6
  // Line In:
  // -- prefix: x-rincon-stream
  // -- example: x-rincon-stream:RINCON_542A1B838E8301400
  // Queue:
  // -- prefix: x-rincon-queue
  // -- example: x-rincon-queue:RINCON_542A1B838E8301400

  // Current URI Examples from getMediaInfo
  // Spotify: x-rincon-queue
  // TV: x-sonos-htastream:spdif
  // Sonos Radio: x-sonosapi-radio
  // Line In: x-rincon-stream
  // Queue: x-rincon-queue

  static SOURCE_TYPE = {
    SPOTIFY: "x-sonos-spotify",
    TV: "x-sonos-htastream",
    LINE_IN: "x-rincon-stream",
    QUEUE: "x-rincon-queue",
  };

  constructor() {
    this.audioIn = new SonosService(this, "AudioIn");
    this.avTransport = new SonosService(this, "AVTransport", "MediaRenderer/AVTransport");
    this.deviceProperties = new SonosService(this, "DeviceProperties");
    this.renderingControl = new SonosService(this, "RenderingControl", "MediaRenderer/RenderingControl");
    this.zoneGroupTopology = new SonosService(this, "ZoneGroupTopology");
    this.contentDirectory = new SonosService(this, "ContentDirectory", "MediaServer/ContentDirectory");
  }

  connect(host, port = 1400) {
    this.host = host;
    this.port = port;
  }

  isConnected() {
    return this.host && this.port;
  }
  async play() {
    return this.avTransport.execute("Play", { Speed: 1 });
  }

  async pause() {
    return this.avTransport.execute("Pause");
  }

  async next() {
    return this.avTransport.execute("Next");
  }

  async previous() {
    return this.avTransport.execute("Previous");
  }
  async removeAllTracksFromQueue() {
    return this.avTransport.execute("RemoveAllTracksFromQueue");
  }
  async getDeviceLocationByUUID(uuid) {
    const zoneGroupState = await this.getZoneGroupState();
    const jsonState = this.convertXmlToJson(zoneGroupState);

    // Helper function to extract location from member
    const extractLocation = (member) => {
      if (!member?.["@attributes"]?.Location) return null;

      const locationUrl = member["@attributes"].Location;
      const match = locationUrl.match(/http:\/\/([\d.]+):(\d+)/);
      if (!match) return null;

      return {
        host: match[1],
        port: parseInt(match[2]),
      };
    };

    // Search through all zone groups
    const groups = jsonState?.ZoneGroups?.ZoneGroup || [];
    for (const group of groups) {
      // Check main zone group member
      const member = group.ZoneGroupMember;
      if (Array.isArray(member)) {
        // Handle multiple members
        for (const m of member) {
          if (m["@attributes"]?.UUID === uuid) {
            return extractLocation(m);
          }
        }
      } else if (member?.["@attributes"]?.UUID === uuid) {
        return extractLocation(member);
      }

      // Check satellites if they exist
      const satellite = member?.Satellite;
      if (satellite?.["@attributes"]?.UUID === uuid) {
        return extractLocation(satellite);
      }
    }

    throw new Error(`Device with UUID ${uuid} not found`);
  }

  async getDeviceCapabilities() {
    return this.avTransport.execute("GetDeviceCapabilities");
  }

  async getDevices({ setAsPrimary = false } = {}) {
    const zoneGroupState = await this.getZoneGroupState();
    const jsonState = this.convertXmlToJson(zoneGroupState);
    const devices = {};

    // Helper function to extract device info from member
    const extractDeviceInfo = (member) => {
      if (!member?.["@attributes"]) return null;

      const locationUrl = member["@attributes"].Location;
      const match = locationUrl?.match(/http:\/\/([\d.]+):(\d+)/);
      if (!match) return null;

      return {
        primary: this.host === match[1] && setAsPrimary,
        hostAddress: match[1],
        port: parseInt(match[2]),
        zoneName: member["@attributes"].ZoneName,
        isSatellite: member["@attributes"].Invisible === "1",
        idleState: member["@attributes"].IdleState || "ACTIVE",
        // satelliteController: member.Satellite?.["@attributes"]?.UUID || null,
        uuid: member["@attributes"].UUID,
      };
    };

    // Process all zone groups
    const groups = jsonState?.ZoneGroups?.ZoneGroup || [];
    for (const group of groups) {
      // Handle zone group members
      const members = group.ZoneGroupMember;
      if (Array.isArray(members)) {
        members.forEach((member) => {
          const deviceInfo = extractDeviceInfo(member);
          if (deviceInfo) {
            devices[member["@attributes"].UUID] = deviceInfo;
          }
        });
      } else if (members?.["@attributes"]) {
        const deviceInfo = extractDeviceInfo(members);
        if (deviceInfo) {
          devices[members["@attributes"].UUID] = deviceInfo;
        }
      }

      // Handle satellites
      const member = group.ZoneGroupMember;
      if (!Array.isArray(member) && member?.Satellite?.["@attributes"]) {
        const deviceInfo = extractDeviceInfo(member.Satellite);
        if (deviceInfo) {
          devices[member.Satellite["@attributes"].UUID] = deviceInfo;
        }
      }
    }

    return { list: devices };
  }

  async getDeviceInfo(getQueue = false) {
    try {
      const [transportSettings, transportInfo, muted, volume, bass, treble, positionInfo, queue] = await Promise.all([
        this.getTransportSettings(),
        this.getTransportInfo(),
        this.getMute(),
        this.getVolume(),
        this.getBass(),
        this.getTreble(),
        this.getPositionInfo(),
        getQueue ? this.getQueue() : null,
      ]);

      let playing = null;
      if (positionInfo.TrackMetaData != "NOT_IMPLEMENTED") {
        const track = new DOMParser().parseFromString(positionInfo.TrackMetaData, "text/xml");
        playing = {
          position: parseInt(positionInfo.RelTime),
          elapsedSec: positionInfo.RelTime.split(":").reduce((p, c) => p * 60 + +c, 0),
          durationSec: positionInfo.TrackDuration.split(":").reduce((p, c) => p * 60 + +c, 0),
          currentTrack: positionInfo.Track - 1,
          title: this.getElementText(track, "dc:title"),
          artist: this.getElementText(track, "dc:creator"),
          album: this.getElementText(track, "upnp:album"),
          albumArtURI: this.getAlbumArtURI(track),
        };
      }
      return {
        audioEqualizer: {
          bass: parseInt(bass.CurrentBass),
          treble: parseInt(treble.CurrentTreble),
          volume: parseInt(volume.CurrentVolume),
        },
        playMode: transportSettings.PlayMode,
        playbackState: transportInfo.CurrentTransportState,
        currentURI: positionInfo.TrackURI,
        muted: muted.CurrentMute === "1",
        playing,
        debug: [transportSettings, transportInfo, muted, volume, positionInfo],
        queue,
      };
    } catch (error) {
      throw new Error(`Failed to get device info: ${error.message}`);
    }
  }

  async getMediaInfo() {
    return this.avTransport.execute("GetMediaInfo");
  }

  async getMute() {
    return this.renderingControl.execute("GetMute", { Channel: "Master" });
  }

  async getPositionInfo() {
    return this.avTransport.execute("GetPositionInfo");
  }

  async getTransportInfo() {
    return this.avTransport.execute("GetTransportInfo");
  }

  async getTransportSettings() {
    return this.avTransport.execute("GetTransportSettings");
  }

  async getZoneAttributes() {
    return this.deviceProperties.execute("GetZoneAttributes");
  }

  async getZoneGroupState() {
    //return from cache if we already fetched the zones
    if (this.zoneGroupState) {
      return Promise.resolve(this.zoneGroupState);
    }

    const { ZoneGroupState: state } = await this.zoneGroupTopology.execute("GetZoneGroupState");
    const zoneGroupState = new DOMParser().parseFromString(state, "text/xml");
    this.zoneGroupState = zoneGroupState;
    return zoneGroupState;
  }

  async getZoneInfo() {
    return this.deviceProperties.execute("GetZoneInfo");
  }

  async setPlayMode(playMode) {
    return this.avTransport.execute("SetPlayMode", { NewPlayMode: playMode });
  }

  async setLocalTransport(prefix, suffix) {
    const zoneGroupState = await this.getZoneGroupState();
    const coordinator = zoneGroupState.querySelector("ZoneGroup").getAttribute("Coordinator");
    return this.setAVTransportURI(`${prefix}:${coordinator}${suffix || ""}`);
  }

  async setAVTransportURI(uri, metadata) {
    return this.avTransport.execute("SetAVTransportURI", {
      CurrentURI: uri,
      CurrentURIMetaData: metadata || "",
    });
  }

  async setMute(mute) {
    return this.renderingControl.execute("SetMute", {
      Channel: "Master",
      DesiredMute: mute ? "1" : "0",
    });
  }

  async getBass() {
    return this.renderingControl.execute("GetBass", { Channel: "Master" });
  }

  async setBass(bass) {
    return this.renderingControl.execute("SetBass", { DesiredBass: bass });
  }

  async getTreble() {
    return this.renderingControl.execute("GetTreble");
  }

  async setTreble(treble) {
    return this.renderingControl.execute("SetTreble", {
      DesiredTreble: treble,
    });
  }

  async getVolume() {
    return this.renderingControl.execute("GetVolume", { Channel: "Master" });
  }

  async setVolume(volume) {
    return this.renderingControl.execute("SetVolume", {
      Channel: "Master",
      DesiredVolume: volume,
    });
  }

  async setRelativeVolume(relativeVolume) {
    return this.renderingControl.execute("SetRelativeVolume", {
      Channel: "Master",
      RelativeVolume: relativeVolume,
    });
  }

  async setServiceURI({ uri, metadata }) {
    if (uri.startsWith("x-sonosapi-stream:")) {
      return this.setAVTransportURI(uri, metadata);
    }

    //add playlist to end of queue
    const { FirstTrackNumberEnqueued: trackNr } = await this.addURIToQueue(uri, metadata);
    if (!trackNr) throw new Error(`Failed to add URI "${uri}" to queue`);

    //switch source to queue
    await this.setLocalTransport("x-rincon-queue", "#0");

    //set active track to the first in the playlist
    return this.seek("TRACK_NR", trackNr);
  }

  async seek(unit, target) {
    return this.avTransport.execute("Seek", { Unit: unit, Target: target });
  }

  async addURIToQueue(uri, metadata, position, next) {
    return this.avTransport.execute("AddURIToQueue", {
      EnqueuedURI: uri,
      EnqueuedURIMetaData: metadata,
      DesiredFirstTrackNumberEnqueued: position || 0,
      EnqueueAsNext: next ? "1" : "0",
    });
  }

  async browse(type, term, categories, start, count) {
    let objectId = type;
    if (categories) objectId += "/" + categories.map((c) => encodeURIComponent(c)).join("/");
    if (term) objectId += ":" + encodeURIComponent(type);

    const { Result: result } = await this.contentDirectory.execute("Browse", {
      ObjectID: objectId,
      BrowseFlag: "BrowseDirectChildren",
      Filter: "*",
      StartingIndex: start || "0",
      RequestedCount: count || "100",
      SortCriteria: "",
    });

    const items = new DOMParser().parseFromString(result, "text/xml");
    return [...items.querySelectorAll("item")].map((i) => ({
      title: this.getElementText(i, "dc:title"),
      uri: this.getElementText(i, "res"),
      metadata: this.getElementText(i, "r:resMD"),
      albumArtURI: this.getAlbumArtURI(i),
    }));
  }

  async getFavorites(start = 0, count = 100) {
    return this.contentDirectory
      .execute("Browse", {
        ObjectID: SonosController.BROWSE_TYPE.SONOS_FAVORITES,
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: start.toString(),
        RequestedCount: count.toString(),
        SortCriteria: "",
      })
      .then(({ Result: result }) => {
        const items = new DOMParser().parseFromString(result, "text/xml");
        // console.log(items);
        const list = [...items.querySelectorAll("item")].map((i) => ({
          title: this.getElementText(i, "dc:title"),
          uri: this.getElementText(i, "res"),
          metadata: this.getElementText(i, "r:resMD"),
          albumArtURI: this.getAlbumArtURI(i),
        }));
        return { start, count, list };
      });
  }

  async getQueue(start = 0, count = 100) {
    return this.contentDirectory
      .execute("Browse", {
        ObjectID: "Q:0",
        BrowseFlag: "BrowseDirectChildren",
        Filter: "*",
        StartingIndex: start.toString(),
        RequestedCount: count.toString(),
        SortCriteria: "",
      })
      .then(({ Result: result }) => {
        const items = new DOMParser().parseFromString(result, "text/xml");
        const list = [...items.querySelectorAll("item")].map((i) => ({
          title: this.getElementText(i, "dc:title"),
          artist: this.getElementText(i, "dc:creator"),
          album: this.getElementText(i, "upnp:album"),
          uri: this.getElementText(i, "res"),
          albumArtURI: this.getAlbumArtURI(i),
        }));
        return { start, count, list };
      });
  }

  getElementText(xml, elementName) {
    const elements = xml.getElementsByTagName(elementName);
    return elements.length && elements[0].childNodes.length ? elements[0].childNodes[0].nodeValue : null;
  }

  getAlbumArtURI(metadata) {
    let albumArtURI = this.getElementText(metadata, "upnp:albumArtURI");
    if (albumArtURI && !albumArtURI.startsWith("http")) albumArtURI = `http://${this.host}:${this.port}${albumArtURI}`;
    return albumArtURI;
  }

  convertXmlToJson(xml) {
    // Handle different node types
    switch (xml.nodeType) {
      case 1: {
        // ELEMENT_NODE
        const obj = {};

        // Handle attributes
        if (xml.attributes.length > 0) {
          obj["@attributes"] = Object.fromEntries([...xml.attributes].map((attr) => [attr.nodeName, attr.nodeValue]));
        }

        // Handle child nodes
        [...xml.childNodes].forEach((child) => {
          const nodeName = child.nodeName;
          const value = this.convertXmlToJson(child);

          if (value !== null) {
            if (nodeName === "#text") {
              if (!obj["#text"]) obj["#text"] = value;
            } else {
              // Convert to array if duplicate keys exist
              if (nodeName in obj) {
                if (!Array.isArray(obj[nodeName])) {
                  obj[nodeName] = [obj[nodeName]];
                }
                obj[nodeName].push(value);
              } else {
                obj[nodeName] = value;
              }
            }
          }
        });

        return Object.keys(obj).length ? obj : null;
      }
      case 3: {
        // TEXT_NODE
        const value = xml.nodeValue.trim();
        return value || null;
      }
      case 4: // CDATA_SECTION_NODE
        return xml.nodeValue.trim() || null;

      case 8: // COMMENT_NODE
        // Optionally handle comments
        // return `<!--${xml.nodeValue}-->`;
        return null;

      case 9: // DOCUMENT_NODE
        return this.convertXmlToJson(xml.documentElement);

      case 10: // DOCUMENT_TYPE_NODE
        // Usually ignored in JSON conversion
        return null;

      default:
        return null;
    }
  }
}

class SonosService {
  constructor(sonos, name, baseUrl) {
    this.sonos = sonos;
    this.name = name;
    this.baseUrl = baseUrl || name;
  }

  async execute(action, params) {
    if (!this.sonos.isConnected()) throw new Error("Not connected to sonos");

    params = params || {};
    params.InstanceID = params.InstanceID || 0;

    const url = `http://${this.sonos.host}:${this.sonos.port}/${this.baseUrl}/Control`;
    const soapAction = `"urn:schemas-upnp-org:service:${this.name}:1#${action}"`;
    const xmlParams = Object.keys(params)
      .map((key) => `<${key}>${this.escape(params[key])}</${key}>`)
      .join("");
    const request = `<?xml version="1.0" encoding="utf-8"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                <s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${this.name}:1">${xmlParams}</u:${action}></s:Body>
            </s:Envelope>`;

    const data = await fetch(url, {
      method: "POST",
      headers: {
        SOAPAction: soapAction,
        "Content-type": "text/xml; charset=utf8",
      },
      body: request,
    });
    const responseText = await data.text();
    if (!data.ok) throw new Error(responseText);

    const responseDocument = new DOMParser().parseFromString(responseText, "text/xml");
    const response = {};
    responseDocument.querySelectorAll("Body>* *").forEach((node) => (response[node.nodeName] = node.textContent));
    return response;
  }

  escape(txt) {
    return txt
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

// Commented out for now may re-enable in the future
// class MusicService {
//   static URI_TYPE = {
//     album: {
//       prefix: "x-rincon-cpcontainer:1004206c",
//       key: "00040000",
//       class: "object.container.album.musicAlbum",
//     },
//     episode: {
//       prefix: "",
//       key: "00032020",
//       class: "object.item.audioItem.musicTrack",
//     },
//     track: {
//       prefix: "",
//       key: "00032020",
//       class: "object.item.audioItem.musicTrack",
//     },
//     show: {
//       prefix: "x-rincon-cpcontainer:1006206c",
//       key: "1006206c",
//       class: "object.container.playlistContainer",
//     },
//     song: {
//       prefix: "",
//       key: "10032020",
//       class: "object.item.audioItem.musicTrack",
//     },
//     playlist: {
//       prefix: "x-rincon-cpcontainer:1006206c",
//       key: "1006206c",
//       class: "object.container.playlistContainer",
//     },
//     radio: {
//       prefix: "x-sonosapi-stream:",
//       key: "F00092020",
//       class: "object.item.audioItem.audioBroadcast",
//     },
//   };

//   static FACTORIES = [
//     (uri) => {
//       const m = uri.match(/spotify.*[:/](album|episode|playlist|show|track)[:/](\w+)/);
//       return m ? new MusicService(2311, m[1], `spotify:${m[1]}:${m[2]}`) : null;
//     },
//     (uri) => {
//       const m = uri.match(/https:\/\/tidal.*[:/](album|track|playlist)[:/]([\w-]+)/);
//       return m ? new MusicService(44551, m[1], `${m[1]}/${m[2]}`) : null;
//     },
//     (uri) => {
//       const m = uri.match(/https:\/\/www.deezer.*[:/](album|track|playlist)[:/]([\w-]+)/);
//       return m ? new MusicService(519, m[1], `${m[1]}-${m[2]}`) : null;
//     },
//     (uri) => {
//       const m = uri.match(/https:\/\/music\.apple\.com\/\w+\/(album|playlist)\/[^/]+\/(?:pl\.)?([-a-zA-Z0-9]+)(?:\?i=(\d+))?/);
//       if (!m) return null;

//       const type = m[3] ? "song" : m[1];
//       const id = m[3] || m[2];
//       return new MusicService(52231, type, `${type}:${id}`);
//     },
//     (uri) => {
//       const m = uri.match(/https:\/\/tunein.com\/(radio)\/.*(s\d+)/);
//       return m ? new MusicService(65031, m[1], m[2], 254) : null;
//     },
//   ];

//   static parse(uri) {
//     for (const factory of MusicService.FACTORIES) {
//       const service = factory(uri);
//       if (service) return service;
//     }
//   }

//   constructor(serviceId, type, uri, broadcastId) {
//     this.serviceId = serviceId;
//     this.type = MusicService.URI_TYPE[type];
//     this.encodedUri = encodeURIComponent(uri);
//     this.broadcastId = broadcastId;
//   }

//   get metadata() {
//     return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
//             <item id="${this.type.key}${this.encodedUri}" restricted="true">
//                 <dc:title>Stream Deck</dc:title><upnp:class>${this.type.class}</upnp:class>
//                 <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON${this.serviceId}_</desc>
//             </item>
//         </DIDL-Lite>`;
//   }

//   get uri() {
//     return this.type.prefix + this.encodedUri + (this.broadcastId ? `?sid=${this.broadcastId}` : "");
//   }
// }
