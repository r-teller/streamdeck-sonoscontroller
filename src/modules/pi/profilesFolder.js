/**
 * The PI is served from <StreamDeck data>/Plugins/<plugin>.sdPlugin/pi.html; profiles live in
 * <StreamDeck data>/ProfilesV2. Stream Deck 7 will not open a file:// folder via openUrl (sonos-sad),
 * so the PI shows this path for the user to copy into Explorer / Finder instead.
 *
 * @param {string} href - the PI page's own location
 * @returns {string|null} native filesystem path of the profiles folder, or null outside Stream Deck
 */
export function profilesFolderPath(href) {
  let url;
  try {
    url = new URL("../../ProfilesV2", href);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;

  const path = decodeURIComponent(url.pathname);
  // Windows: "/C:/Users/..." -> "C:\Users\..."
  if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1).replace(/\//g, "\\");
  return path;
}

/**
 * Copies text to the clipboard. The async Clipboard API can be unavailable or denied in the Stream
 * Deck PI webview, so fall back to selecting a text field and execCommand("copy").
 *
 * @param {string} text
 * @param {HTMLInputElement|null} [field] - input holding the text, used for the fallback
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyText(text, field = null) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection-based copy
  }
  if (!field) return false;
  try {
    field.focus();
    field.select();
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  }
}
