// Stream Deck simulator server: static hosting + same-origin Sonos proxy.
// Usage: node simulator/server.mjs [port]   (default 8900)
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname; // repo root
const PORT = Number(process.argv[2]) || 8900;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".xml": "text/xml" };

const serveFile = async (res, path) => {
  try {
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found: " + path);
  }
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");

  // Same-origin proxy: POST /sonos/<host>/<control-path>  ->  http://<host>:1400/<control-path>
  const proxy = p.match(/^\/sonos\/([0-9a-zA-Z.\-]+)(\/.*)$/);
  if (proxy) {
    const [_, host, basePath] = proxy;
    const path = basePath + (url.search || "");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const out = httpRequest(
        { host, port: 1400, path, method: req.method,
          headers: { SOAPAction: req.headers.soapaction || "", "Content-Type": req.headers["content-type"] || 'text/xml; charset="utf-8"', "Content-Length": body.length } },
        (up) => {
          const ups = [];
          up.on("data", (c) => ups.push(c));
          up.on("end", () => { res.writeHead(up.statusCode || 502, { "Content-Type": "text/xml" }); res.end(Buffer.concat(ups)); });
        }
      );
      out.on("error", (e) => { res.writeHead(502); res.end("proxy error: " + e.message); });
      out.setTimeout(10000, () => out.destroy(new Error("timeout")));
      out.end(body);
    });
    return;
  }

  if (p === "/" || p === "/index.html") return serveFile(res, join(ROOT, "simulator/index.html"));
  if (p === "/sim-host.js") return serveFile(res, join(ROOT, "simulator/sim-host.js"));
  if (p.startsWith("/fixtures/")) return serveFile(res, join(ROOT, "tests/fixtures/sonos", p.slice(10)));
  if (p.startsWith("/dist/")) return serveFile(res, join(ROOT, "simulator/dist", p.slice(6)));
  res.writeHead(404); res.end("not found");
}).listen(PORT, "0.0.0.0", () => console.log(`simulator on http://localhost:${PORT}/`));
