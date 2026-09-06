import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

export async function installMockSonos(page, options = {}) {
  const {
    topologyFixture = "zonegroupstate-multi-group.xml",
    favoritesFixture = "browse-fv2-mixed.xml",
    queueFixture = "browse-q0-five-tracks.xml",
    failures = {}
  } = options;

  const calls = [];
  const failureModes = { ...failures };

  const fixtures = {
    topology: readFileSync(join(process.cwd(), "tests/fixtures/sonos", topologyFixture), "utf8"),
    favorites: readFileSync(join(process.cwd(), "tests/fixtures/sonos", favoritesFixture), "utf8"),
    queue: readFileSync(join(process.cwd(), "tests/fixtures/sonos", queueFixture), "utf8"),
    emptyResponse: readFileSync(join(process.cwd(), "tests/fixtures/sonos", "soap-empty-response.xml"), "utf8"),
    fault500: readFileSync(join(process.cwd(), "tests/fixtures/sonos", "soap-fault-401.xml"), "utf8")
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
    const clean = soapAction.replace(/"/g, '').trim();
    const idx = clean.indexOf('#');
    return idx === -1 ? null : clean.slice(idx + 1);
  }

  function parseBodyArgs(body) {
    // Minimal parsing: extract ObjectID if present
    const objIdMatch = body.match(/<ObjectID>([^<]+)<\/ObjectID>/);
    return objIdMatch ? { ObjectID: objIdMatch[1] } : {};
  }

  function setFailure(routeKey, mode) {
    failureModes[routeKey] = mode;
  }

  function clearCalls() {
    calls.length = 0;
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
      bodyArgs: parseBodyArgs(body)
    });

    // Apply failure mode if set
    const mode = failureModes[serviceKey];
    if (mode) {
      if (mode.mode === "hang") {
        await new Promise(resolve => setTimeout(resolve, mode.ms ?? 6000));
        // Client will abort before fulfillment, but we still fulfill to avoid hanging Playwright
        await route.fulfill({
          status: 200,
          contentType: 'text/xml; charset="utf-8"',
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fixtures.emptyResponse
        });
        return;
      }
      if (mode.mode === "fault500") {
        await route.fulfill({
          status: 500,
          contentType: 'text/xml; charset="utf-8"',
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fixtures.fault500
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
          body: "<not-xml"
        });
        return;
      }
    }

    // Normal dispatch
    let responseXml = "";
    let status = 200;

    if (serviceKey === "topology" && action === "GetZoneGroupState") {
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

    await route.fulfill({
      status,
      contentType: 'text/xml; charset="utf-8"',
      headers: { "Access-Control-Allow-Origin": "*" },
      body: responseXml
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
    clearCalls
  };
}
