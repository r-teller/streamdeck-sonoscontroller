import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const keys = [
  "currently_playing",
  "equalizer",
  "input_line_in",
  "input_sonos_queue",
  "input_tv",
  "muted",
  "next_track",
  "paused",
  "play_favorite",
  "play_normal",
  "playing",
  "previous_track",
  "repeat_all",
  "repeat_one",
  "shuffle_no_repeat",
  "shuffle_on",
  "shuffle_one",
  "stopped",
  "unmuted",
  "volume_down",
  "volume_up"
];

const actions = [
  { name: "currently_playing", svg: "assets/icons/currently_playing.svg" },
  { name: "equalizer", svg: "assets/icons/equalizer.svg" },
  { name: "input_source", svg: "assets/icons/input_source.svg" },
  { name: "muted", svg: "assets/icons/muted.svg" },
  { name: "next_track", svg: "assets/icons/next_track.svg" },
  { name: "paused", svg: "assets/icons/paused.svg" },
  { name: "play_favorite", svg: "assets/icons/play_favorite.svg" },
  { name: "previous_track", svg: "assets/icons/previous_track.svg" },
  { name: "shuffle", svg: "assets/icons/shuffle_no_repeat.svg" },
  { name: "volume_down", svg: "assets/icons/volume_down.svg" },
  { name: "volume_up", svg: "assets/icons/volume_up.svg" }
];

const topLevels = [
  { class: "brand", svg: "assets/icons/sonos.svg", out: "public/images/sonos" },
  { class: "category", svg: "assets/icons/category.svg", out: "public/images/category" },
  { class: "card", svg: "assets/icons/plugin_card.svg", out: "public/images/plugin/plugin" }
];

async function renderIcons() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Helper to read SVG content
  function readSvg(path) {
    return readFileSync(join(rootDir, path), "utf8");
  }

  // Helper to render a single icon
  async function renderIcon(svgPath, className, outPrefix, size1x, size2x, extraStyles = "") {
    const svgContent = readSvg(svgPath);

    // Helper to render for a given size
    async function renderForSize(size, outSuffix) {
      let html;
      if (className === "key" || className === "brand") {
        const radius = size >= 144 ? 28 : 14;
        const glyphSize = size >= 144 ? 80 : 40;
        html = `
          <style>
            html,body{margin:0;background:transparent}
            .bg{width:${size}px;height:${size}px;border-radius:${radius}px;background:#d8a158;display:flex;align-items:center;justify-content:center}
            .bg svg{width:${glyphSize}px;height:${glyphSize}px;display:block;color:#1a1a1a}
          </style>
          <div class="bg">${svgContent}</div>
        `;
      } else if (className === "action" || className === "category") {
        const color = className === "action" ? "#d8d8d8" : "#c8c8c8";
        html = `
          <style>
            html,body{margin:0;background:transparent}
            .icon{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center}
            .icon svg{width:100%;height:100%;display:block;color:${color}}
          </style>
          <div class="icon">${svgContent}</div>
        `;
      } else if (className === "card") {
        html = `
          <style>
            html,body{margin:0;background:#000}
            .card svg{width:100%;height:100%;display:block}
          </style>
          <div class="card">${svgContent}</div>
        `;
      }

      const outputPath = join(rootDir, outSuffix + ".png");
      mkdirSync(dirname(outputPath), { recursive: true });
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(html);
      await page.screenshot({ path: outputPath, omitBackground: className !== "card" });
      console.log(outputPath);
    }

    // Render 1x and 2x
    await renderForSize(size1x, outPrefix);
    await renderForSize(size2x, outPrefix + "@2x");
  }

  // Render keys
  for (const name of keys) {
    const svgPath = `assets/icons/${name}.svg`;
    await renderIcon(svgPath, "key", `public/images/keys/${name}`, 72, 144);
  }

  // Render actions
  for (const action of actions) {
    await renderIcon(action.svg, "action", `public/images/actions/${action.name}`, 20, 40);
  }

  // Render top-level
  for (const item of topLevels) {
    if (item.class === "card") {
      const svgContent = readSvg(item.svg);
      const html = `
        <style>
          html,body{margin:0;background:#000}
          .card svg{width:100%;height:100%;display:block}
        </style>
        <div class="card">${svgContent}</div>
      `;
      const outputPath1x = join(rootDir, `${item.out}.png`);
      const outputPath2x = join(rootDir, `${item.out}@2x.png`);
      mkdirSync(dirname(outputPath1x), { recursive: true });
      mkdirSync(dirname(outputPath2x), { recursive: true });

      await page.setViewportSize({ width: 288, height: 200 });
      await page.setContent(html);
      await page.screenshot({ path: outputPath1x, omitBackground: false });
      console.log(outputPath1x);

      await page.setViewportSize({ width: 576, height: 400 });
      await page.setContent(html);
      await page.screenshot({ path: outputPath2x, omitBackground: false });
      console.log(outputPath2x);
    } else if (item.class === "brand") {
      await renderIcon(item.svg, "brand", item.out, 72, 144);
    } else if (item.class === "category") {
      await renderIcon(item.svg, "category", item.out, 28, 56);
    }
  }

  await browser.close();
  process.exit(0);
}

await renderIcons();
