// Stream Deck simulator — page-side shim. Injected as the FIRST script into the
// built plugin.html / pi.html copies so it can replace WebSocket and fetch before
// any bundle code runs. The control page (simulator/index.html) plays the host.
(() => {
  const params = new URLSearchParams(location.search);
  const role = params.get("simRole"); // "plugin" | "pi"
  if (!role) return;
  const pageId = role === "plugin" ? "plugin" : "pi-" + (params.get("simCtx") || "0");
  const bus = new BroadcastChannel("sd-sim-bus");

  // ---- fake WebSocket bridged onto the BroadcastChannel ----
  class SimWebSocket {
    constructor() {
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen && this.onopen({});
      }, 0);
    }
    send(json) {
      bus.postMessage({ dir: "toHost", pageId, frame: JSON.parse(json) });
    }
    close() { this.readyState = 3; this.onclose && this.onclose({ code: 1000, reason: "sim" }); }
  }
  SimWebSocket.CLOSED = 3;
  window.WebSocket = SimWebSocket;

  bus.addEventListener("message", (e) => {
    const m = e.data;
    if (m.dir !== "toPage" || (m.pageId !== pageId && m.pageId !== "*")) return;
    const ws = currentSocketHolder.ws;
    if (ws && ws.onmessage) ws.onmessage({ data: JSON.stringify(m.frame) });
  });
  // capture the most recent socket (the client constructs exactly one per connect)
  const currentSocketHolder = { ws: null };
  const OrigCtor = SimWebSocket;
  window.WebSocket = function (...a) {
    const ws = new OrigCtor(...a);
    currentSocketHolder.ws = ws;
    return ws;
  };
  Object.assign(window.WebSocket, OrigCtor);

  // ---- Sonos backend: intercept fetch to port 1400 ----
  const origFetch = window.fetch.bind(window);
  const FIX = {
    GetZoneGroupState: "zonegroupstate-multi-group.xml",
    GetTransportSettings: "gettransportsettings-shuffle.xml",
    GetTransportInfo: "gettransportinfo-playing.xml",
    GetMute: "getmute-unmuted-response.xml",
    GetVolume: "soap-getvolume-response.xml",
    GetBass: "getbass-response.xml",
    GetTreble: "gettreble-response.xml",
    GetPositionInfo: "getpositioninfo-spotify-track.xml",
  };
  // small mutable household state so fixture mode feels alive
  const state = { muted: false, volume: 42, bass: -3, treble: 5, playing: true, playMode: "SHUFFLE_NOREPEAT" };
  const fixCache = {};
  async function fixture(name) {
    if (!fixCache[name]) fixCache[name] = await (await origFetch("/fixtures/" + name)).text();
    return fixCache[name];
  }
  async function mockSonos(url, opts) {
    const action = (opts.headers?.SOAPAction || opts.headers?.soapaction || "").match(/#(\w+)"/)?.[1] || "";
    const body = String(opts.body || "");
    let text;
    if (action === "Browse") {
      text = await fixture(body.includes("FV:2") ? "browse-fv2-mixed.xml" : "browse-q0-five-tracks.xml");
    } else if (FIX[action]) {
      text = await fixture(FIX[action]);
      if (action === "GetMute") text = text.replace(/<CurrentMute>\d<\/CurrentMute>/, `<CurrentMute>${state.muted ? 1 : 0}</CurrentMute>`);
      if (action === "GetVolume") text = text.replace(/<CurrentVolume>\d+<\/CurrentVolume>/, `<CurrentVolume>${state.volume}</CurrentVolume>`);
      if (action === "GetBass") text = text.replace(/<CurrentBass>-?\d+<\/CurrentBass>/, `<CurrentBass>${state.bass}</CurrentBass>`);
      if (action === "GetTreble") text = text.replace(/<CurrentTreble>-?\d+<\/CurrentTreble>/, `<CurrentTreble>${state.treble}</CurrentTreble>`);
      if (action === "GetTransportInfo" && !state.playing) text = text.replace("PLAYING", "PAUSED_PLAYBACK");
      if (action === "GetTransportSettings") text = text.replace(/<PlayMode>\w+<\/PlayMode>/, `<PlayMode>${state.playMode}</PlayMode>`);
    } else {
      // set-style commands mutate state, answer generic success
      if (action === "SetMute") state.muted = /<DesiredMute>1</.test(body);
      if (action === "SetVolume") state.volume = +(body.match(/<DesiredVolume>(\d+)</)?.[1] ?? state.volume);
      if (action === "SetBass") state.bass = +(body.match(/<DesiredBass>(-?\d+)</)?.[1] ?? state.bass);
      if (action === "SetTreble") state.treble = +(body.match(/<DesiredTreble>(-?\d+)</)?.[1] ?? state.treble);
      if (action === "Play") state.playing = true;
      if (action === "Pause") state.playing = false;
      if (action === "SetPlayMode") state.playMode = body.match(/<NewPlayMode>(\w+)</)?.[1] ?? state.playMode;
      text = await fixture("soap-empty-response.xml");
    }
    bus.postMessage({ dir: "log", pageId, soap: { action, url } });
    return new Response(text, { status: 200, headers: { "Content-Type": "text/xml" } });
  }
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const m = u.match(/^https?:\/\/([^:/]+):1400(\/.*)$/);
    if (!m) return origFetch(url, opts);
    const mode = localStorage.getItem("simSonosMode") || "fixtures";
    if (mode === "real") {
      bus.postMessage({ dir: "log", pageId, soap: { action: "(proxied)", url: u } });
      return origFetch(`/sonos/${m[1]}${m[2]}`, opts);
    }
    return mockSonos(u, opts);
  };

  // ---- register with the host once the bundle has installed its bridge ----
  window.addEventListener("load", () => {
    const tryConnect = (n) => {
      if (typeof window.connectElgatoStreamDeckSocket === "function") {
        const uuid = pageId;
        if (role === "plugin") {
          window.connectElgatoStreamDeckSocket(0, uuid, "registerPlugin", "{}", "");
        } else {
          const actionInfo = JSON.stringify({
            action: params.get("simAction"),
            context: params.get("simCtx"),
            device: "sim-device",
            payload: {
              settings: JSON.parse(sessionStorage.getItem("sim-settings-" + params.get("simCtx")) || "{}"),
              coordinates: { column: 0, row: 0 },
              controller: params.get("simController") || "Keypad",
              state: 0, isInMultiAction: false,
            },
          });
          window.connectElgatoStreamDeckSocket(0, uuid, "registerPropertyInspector", "{}", actionInfo);
        }
        bus.postMessage({ dir: "toHost", pageId, frame: { event: "__simReady" } });
      } else if (n < 100) setTimeout(() => tryConnect(n + 1), 50);
    };
    tryConnect(0);
  });
})();
