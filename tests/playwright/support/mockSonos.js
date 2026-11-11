import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

export async function installMockSonos(page, options = {}) {
  const {
    topologyFixture = "zonegroupstate-multi-group.xml",
    favoritesFixture = "browse-fv2-mixed.xml",
    queueFixture = "browse-q0-five-tracks.xml",
    failures = {},
    actionFixtures = {},
    // Sonos playlists (SQ:) by title -> track URIs, e.g. { "Stream Deck Favorites": [uri, ...] }.
    playlists = {},
  } = options;

  const calls = [];
  const failureModes = { ...failures };
  const actionFixtureState = { ...actionFixtures };
  const fixtureFileCache = {};
  // Like a real speaker, report back the last value the plugin set (the plugin re-polls right after
  // every action, sonos-e9y; a static fixture would undo each change). Kept per speaker host
  // (sonos-8px.2). Each rule: a Set* request and the value it carries, the Get* that reports it and
  // the response tag to rewrite. Applies only when the Get* response has that tag (a fixture is
  // configured); the empty response has none.
  const STATEFUL = [
    { set: "SetVolume", arg: "DesiredVolume", get: "GetVolume", tag: "CurrentVolume" },
    { set: "SetBass", arg: "DesiredBass", get: "GetBass", tag: "CurrentBass" },
    { set: "SetTreble", arg: "DesiredTreble", get: "GetTreble", tag: "CurrentTreble" },
    { set: "SetMute", arg: "DesiredMute", get: "GetMute", tag: "CurrentMute" },
    { set: "SetPlayMode", arg: "NewPlayMode", get: "GetTransportSettings", tag: "PlayMode" },
    { set: "Play", value: "PLAYING", get: "GetTransportInfo", tag: "CurrentTransportState" },
    { set: "Pause", value: "PAUSED_PLAYBACK", get: "GetTransportInfo", tag: "CurrentTransportState" },
    { set: "Stop", value: "STOPPED", get: "GetTransportInfo", tag: "CurrentTransportState" },
    // Jumping to a queue position changes the reported track number (Queue Track dial, sonos-gen.2).
    { set: "Seek", arg: "Target", when: /<Unit>TRACK_NR<\/Unit>/, get: "GetPositionInfo", tag: "Track" },
  ];
  const remembered = {}; // host -> { [getAction]: value }

  function remember(host, action, body) {
    for (const rule of STATEFUL) {
      if (rule.set !== action) continue;
      if (rule.when && !rule.when.test(body ?? "")) continue;
      const value = rule.value ?? (body ?? "").match(new RegExp(`<${rule.arg}>([^<]*)</${rule.arg}>`))?.[1];
      if (value !== undefined) (remembered[host] ??= {})[rule.get] = value;
    }
  }

  function applyRemembered(host, action, xml) {
    for (const rule of STATEFUL) {
      const value = remembered[host]?.[rule.get];
      if (rule.get === action && value !== undefined) {
        xml = xml.replace(new RegExp(`<${rule.tag}>[^<]*</${rule.tag}>`), `<${rule.tag}>${value}</${rule.tag}>`);
      }
    }
    return xml;
  }

  const fixtures = {
    topology: readFileSync(join(process.cwd(), "tests/fixtures/sonos", topologyFixture), "utf8"),
    favorites: readFileSync(join(process.cwd(), "tests/fixtures/sonos", favoritesFixture), "utf8"),
    queue: readFileSync(join(process.cwd(), "tests/fixtures/sonos", queueFixture), "utf8"),
    emptyResponse: readFileSync(join(process.cwd(), "tests/fixtures/sonos", "soap-empty-response.xml"), "utf8"),
    fault500: readFileSync(join(process.cwd(), "tests/fixtures/sonos", "soap-fault-401.xml"), "utf8"),
  };

  function getServiceKey(url) {
    if (url.includes("ZoneGroupTopology")) return "topology";
    if (url.includes("AVTransport")) return "avTransport";
    if (url.includes("RenderingControl")) return "rendering";
    if (url.includes("ContentDirectory")) return "contentDirectory";
    return null;
  }

  function getActionFromHeader(headers) {
    const soapAction = headers["soapaction"];
    if (!soapAction) return null;
    // Strip quotes and extract action after '#'
    const clean = soapAction.replace(/"/g, "").trim();
    const idx = clean.indexOf("#");
    return idx === -1 ? null : clean.slice(idx + 1);
  }

  function parseBodyArgs(body) {
    // Minimal parsing: extract ObjectID if present
    const objIdMatch = body.match(/<ObjectID>([^<]+)<\/ObjectID>/);
    return objIdMatch ? { ObjectID: objIdMatch[1] } : {};
  }

  // --- Sonos playlists (sonos-bg0): a small stateful store like a real household's SQ: list ---
  const playlistStore = Object.entries(playlists).map(([title, uris], i) => ({
    id: `SQ:${i + 1}`,
    title,
    uris: [...uris],
    updateId: 1,
  }));
  const xmlEsc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const arg = (body, name) => {
    const m = body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m
      ? m[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
      : "";
  };
  const envelope = (action, urn, inner) =>
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:schemas-upnp-org:service:${urn}:1">${inner}</u:${action}Response></s:Body></s:Envelope>`;
  const didl = (inner) =>
    `&lt;DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"&gt;${inner}&lt;/DIDL-Lite&gt;`;

  /** Answers playlist requests, or returns null when the request is not about playlists. */
  function playlistResponse(action, body) {
    const id = arg(body, "ObjectID");
    if (action === "Browse" && id === "SQ:") {
      const items = playlistStore
        .map((p) =>
          xmlEsc(
            `<container id="${p.id}" parentID="SQ:" restricted="true"><dc:title>${xmlEsc(p.title)}</dc:title><upnp:class>object.container.playlistContainer</upnp:class></container>`,
          ),
        )
        .join("");
      return envelope(
        "Browse",
        "ContentDirectory",
        `<Result>${didl(items)}</Result><NumberReturned>${playlistStore.length}</NumberReturned><TotalMatches>${playlistStore.length}</TotalMatches><UpdateID>1</UpdateID>`,
      );
    }
    const pl = playlistStore.find((p) => p.id === id);
    if (action === "Browse" && id.startsWith("SQ:")) {
      if (!pl) return { status: 500, xml: fixtures.fault500 };
      const start = Number(arg(body, "StartingIndex")) || 0;
      const count = Number(arg(body, "RequestedCount")) || pl.uris.length;
      const page = pl.uris.slice(start, start + count);
      const items = page
        .map((u) =>
          xmlEsc(
            `<item id="${pl.id}/${xmlEsc(u)}" parentID="${pl.id}" restricted="true"><res protocolInfo="sonos.com-spotify:*:audio/x-spotify:*">${xmlEsc(u)}</res><dc:title>t</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class></item>`,
          ),
        )
        .join("");
      return envelope(
        "Browse",
        "ContentDirectory",
        `<Result>${didl(items)}</Result><NumberReturned>${page.length}</NumberReturned><TotalMatches>${pl.uris.length}</TotalMatches><UpdateID>${pl.updateId}</UpdateID>`,
      );
    }
    if (action === "CreateSavedQueue") {
      const created = { id: `SQ:${playlistStore.length + 1}`, title: arg(body, "Title"), uris: [], updateId: 0 };
      playlistStore.push(created);
      return envelope(
        action,
        "AVTransport",
        `<NumTracksAdded>0</NumTracksAdded><NewQueueLength>0</NewQueueLength><AssignedObjectID>${created.id}</AssignedObjectID><NewUpdateID>0</NewUpdateID>`,
      );
    }
    if (action === "AddURIToSavedQueue" || action === "ReorderTracksInSavedQueue") {
      // Like the speaker: a stale UpdateID is refused.
      if (!pl || String(arg(body, "UpdateID")) !== String(pl.updateId)) return { status: 500, xml: fixtures.fault500 };
      if (action === "AddURIToSavedQueue") pl.uris.push(arg(body, "EnqueuedURI"));
      else {
        const drop = new Set(arg(body, "TrackList").split(",").map(Number));
        pl.uris = pl.uris.filter((_, i) => !drop.has(i));
      }
      pl.updateId += 1;
      return envelope(
        action,
        "AVTransport",
        `<NewQueueLength>${pl.uris.length}</NewQueueLength><NewUpdateID>${pl.updateId}</NewUpdateID>`,
      );
    }
    return null;
  }

  /** The playlist's songs now, by title (tests). */
  function playlistUris(title) {
    return playlistStore.find((p) => p.title === title)?.uris.slice() ?? null;
  }

  /** Changes a playlist as if edited in the Sonos app: new songs and a new change counter. */
  function editPlaylist(title, uris) {
    const pl = playlistStore.find((p) => p.title === title);
    if (pl) {
      pl.uris = [...uris];
      pl.updateId += 1;
    } else {
      playlistStore.push({ id: `SQ:${playlistStore.length + 1}`, title, uris: [...uris], updateId: 1 });
    }
  }

  function setFailure(routeKey, mode) {
    failureModes[routeKey] = mode;
  }

  function clearCalls() {
    calls.length = 0;
  }

  function setActionFixture(action, fixtureFile) {
    // A fixture swapped in mid-test is the newest truth (e.g. "changed from another controller" or
    // "speaker ignored the change"): it must win over what the plugin last set.
    for (const host of Object.keys(remembered)) delete remembered[host][action];
    if (fixtureFile == null) {
      delete actionFixtureState[action];
    } else {
      actionFixtureState[action] = fixtureFile;
    }
  }

  const handleRoute = async (route) => {
    const request = route.request();
    const url = request.url();
    const serviceKey = getServiceKey(url);
    if (!serviceKey) {
      await route.continue();
      return;
    }

    const headers = request.headers();
    const action = getActionFromHeader(headers);
    const body = await request.postData();
    const host = new URL(url).hostname;

    // Record call
    calls.push({
      service: serviceKey,
      action,
      host,
      body,
      bodyArgs: parseBodyArgs(body),
    });

    // Apply failure mode if set
    const mode = failureModes[serviceKey];
    if (mode) {
      if (mode.mode === "hang") {
        await new Promise((resolve) => setTimeout(resolve, mode.ms ?? 6000));
        // Client will abort before fulfillment, but we still fulfill to avoid hanging Playwright
        await route.fulfill({
          status: 200,
          contentType: 'text/xml; charset="utf-8"',
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fixtures.emptyResponse,
        });
        return;
      }
      if (mode.mode === "fault500") {
        await route.fulfill({
          status: 500,
          contentType: 'text/xml; charset="utf-8"',
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fixtures.fault500,
        });
        return;
      }
      if (mode.mode === "abort") {
        await route.abort("connectionrefused");
        return;
      }
      if (mode.mode === "malformed") {
        await route.fulfill({
          status: 200,
          contentType: 'text/xml; charset="utf-8"',
          headers: { "Access-Control-Allow-Origin": "*" },
          body: "<not-xml",
        });
        return;
      }
      if (mode.mode === "delay") {
        await new Promise((resolve) => setTimeout(resolve, mode.ms ?? 1000));
        // Fall through to normal dispatch
      }
    }

    // Normal dispatch
    let responseXml = "";
    let status = 200;

    remember(host, action, body);

    const playlistReply = playlistResponse(action, body);
    // Check for action fixture first
    if (playlistReply) {
      if (typeof playlistReply === "object") {
        status = playlistReply.status;
        responseXml = playlistReply.xml;
      } else {
        responseXml = playlistReply;
      }
    } else if (actionFixtureState[action]) {
      const filename = actionFixtureState[action];
      if (!fixtureFileCache[filename]) {
        fixtureFileCache[filename] = readFileSync(join(process.cwd(), "tests/fixtures/sonos", filename), "utf8");
      }
      responseXml = fixtureFileCache[filename];
    } else if (serviceKey === "topology" && action === "GetZoneGroupState") {
      responseXml = fixtures.topology;
    } else if (serviceKey === "contentDirectory" && action === "Browse") {
      const { ObjectID } = parseBodyArgs(body);
      if (ObjectID === "FV:2") {
        responseXml = fixtures.favorites;
      } else if (ObjectID === "Q:0") {
        responseXml = fixtures.queue;
      } else {
        responseXml = fixtures.emptyResponse;
      }
    } else {
      // AVTransport, RenderingControl, or unknown ContentDirectory action
      responseXml = fixtures.emptyResponse;
    }

    responseXml = applyRemembered(host, action, responseXml);

    await route.fulfill({
      status,
      contentType: 'text/xml; charset="utf-8"',
      headers: { "Access-Control-Allow-Origin": "*" },
      body: responseXml,
    });
  };

  // Register routes
  await page.route("**/ZoneGroupTopology/Control", handleRoute);
  await page.route("**/MediaRenderer/AVTransport/Control", handleRoute);
  await page.route("**/MediaRenderer/RenderingControl/Control", handleRoute);
  await page.route("**/MediaServer/ContentDirectory/Control", handleRoute);

  return {
    calls,
    setFailure,
    clearCalls,
    setActionFixture,
    playlistUris,
    editPlaylist,
  };
}
