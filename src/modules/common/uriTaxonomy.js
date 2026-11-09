const FACTORY_TABLE = Object.freeze([
  Object.freeze({
    currentSource: "TV_Input",
    match: (uri) => typeof uri === "string" && uri.startsWith("x-sonos-htastream") && uri.endsWith(":spdif"),
    prefix: "x-sonos-htastream",
    suffix: ":spdif",
  }),
  Object.freeze({
    currentSource: "Line_In",
    match: (uri) => typeof uri === "string" && uri.startsWith("x-rincon-stream"),
    prefix: "x-rincon-stream",
    suffix: "",
  }),
  Object.freeze({
    currentSource: "Sonos_Queue",
    match: () => true,
    prefix: "x-rincon-queue",
    suffix: "#0",
  }),
]);

export function getInputSourceMappings(uri) {
  const entry = FACTORY_TABLE.find((rule) => rule.match(uri)) || FACTORY_TABLE[2];
  return { currentSource: entry.currentSource, prefix: entry.prefix, suffix: entry.suffix };
}
