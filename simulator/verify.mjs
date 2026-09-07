import { chromium } from "@playwright/test";
const b = await chromium.launch();
const page = await b.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:8900/");
await page.waitForSelector('select[data-ctx="ctx-1"]');
// place Toggle Mute on key 1
await page.selectOption('select[data-ctx="ctx-1"]', "com.r-teller.sonoscontroller.toggle-mute-unmute");
// bind it to a mock speaker by seeding settings the way the PI would
await page.evaluate(() => {
  const settings = { action: "com.r-teller.sonoscontroller.toggle-mute-unmute", controller: "Keypad",
    uuid: "RINCON_KITCHEN01400", title: "Kitchen (192.168.1.43)", hostAddress: "192.168.1.43", zoneName: "Kitchen",
    displayStateBasedTitle: true };
  sessionStorage.setItem("sim-settings-ctx-1", JSON.stringify(settings));
});
// re-place so willAppear carries the binding
await page.selectOption('select[data-ctx="ctx-1"]', "");
await page.selectOption('select[data-ctx="ctx-1"]', "com.r-teller.sonoscontroller.toggle-mute-unmute");
// wait for a poll cycle to render state (fixture: unmuted, playing)
await page.waitForTimeout(4000);
const logText = await page.locator("#log").innerText();
const title1 = await page.locator('.tile[data-ctx="ctx-1"] .title').innerText();
// press the key -> optimistic mute
await page.click('.tile[data-ctx="ctx-1"]');
await page.waitForTimeout(1500);
const title2 = await page.locator('.tile[data-ctx="ctx-1"] .title').innerText();
console.log("== after poll:  title =", JSON.stringify(title1));
console.log("== after press: title =", JSON.stringify(title2));
console.log("== log contains plugin registered:", logText.includes("plugin registered"));
console.log("== log contains SOAP GetMute:", logText.includes("GetMute"));
console.log("== log contains setState:", logText.includes("setState"));
console.log("== console errors:", errors.slice(0, 5));
await b.close();
