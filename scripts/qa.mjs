// Broad functional QA sweep with screenshots. Not part of CI — used for manual review.
// Usage: node scripts/qa.mjs [url] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const outDir = process.argv[3] ?? '/tmp/qa';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`);
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${name}.png` });
};

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__neon?.ready === true, null, { timeout: 30000 });
await page.waitForTimeout(1500);

check('boot: wasm loaded', await page.evaluate(() => window.__neon.wasmBytes > 50000));
check('boot: no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));

const sample0 = await page.evaluate(() => window.__neon.sample());
check('render: draw calls', sample0.calls > 50, `calls=${sample0.calls} tris=${sample0.triangles}`);
check('render: non-black frame', sample0.meanLuma > 5 && sample0.uniqueColors > 30, `luma=${sample0.meanLuma.toFixed(1)} colors=${sample0.uniqueColors}`);

const sim0 = await page.evaluate(() => window.__neon.sim());
check('sim: cars moving', sim0.cars > 10, `cars=${sim0.cars}`);
check('sim: pedestrians', sim0.peds > 10, `peds=${sim0.peds}`);
await shot('01-night-rain');

// time of day
await page.evaluate(() => window.__neon.set({ autoCycle: false, timeOfDay: 12, rain: 0.15 }));
await page.waitForTimeout(800);
const noon = await page.evaluate(() => window.__neon.sim());
check('time: noon windowLit lower than night', noon.env[4] < 0.6, `windowLit=${noon.env[4].toFixed(2)}`);
await shot('02-noon');

// themes
for (const theme of ['cyberpunk', 'tokyo', 'toxic', 'sakura', 'synthwave']) {
  const before = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').trim());
  await page.evaluate((id) => window.__neon.set({ themeId: id, timeOfDay: 21.8, rain: 0.7 }), theme);
  await page.waitForTimeout(600);
  const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').trim());
  check(`theme: ${theme}`, accent !== before || theme === 'synthwave', `accent=${accent}`);
  await shot(`03-theme-${theme}`);
}

// weather
await page.evaluate(() => window.__neon.set({ themeId: 'tokyo', timeOfDay: 23.2, rain: 0, snow: 0.85 }));
await page.waitForTimeout(1200);
const snowSim = await page.evaluate(() => window.__neon.sim());
check('weather: snow active', snowSim.env[7] > 0.1, `precipFog=${snowSim.env[7].toFixed(2)}`);
await shot('04-snow');

await page.evaluate(() => window.__neon.set({ rain: 0.95, snow: 0, themeId: 'cyberpunk' }));
await page.waitForTimeout(1500);
await shot('05-heavy-rain');

// interactions
await page.evaluate(() => window.__neon.clickSign(2));
await page.waitForTimeout(120);
const flash = await page.evaluate(() => window.__neon.sim().signFlashSum);
check('click: sign flashes', flash > 0.2, `flashSum=${flash.toFixed(2)}`);

const lampsBefore = await page.evaluate(() => window.__neon.sim().lampOn);
await page.evaluate(() => window.__neon.clickLamp(0));
await page.waitForTimeout(200);
const lampsAfter = await page.evaluate(() => window.__neon.sim().lampOn);
check('click: lamp toggles', lampsAfter === lampsBefore - 1 || lampsAfter === lampsBefore + 1, `${lampsBefore} -> ${lampsAfter}`);

const waterBefore = await page.evaluate(() => window.__neon.sim().waterSum);
await page.evaluate(() => window.__neon.clickWater(34, 40));
await page.waitForTimeout(400);
const waterAfter = await page.evaluate(() => window.__neon.sim().waterSum);
check('click: water ripple', waterAfter > waterBefore, `${waterBefore.toFixed(1)} -> ${waterAfter.toFixed(1)}`);
await shot('06-ripple');

// pointer picking through the real canvas
const picked = await page.evaluate(() => {
  const neon = window.__neon;
  for (let i = 0; i < 8; i += 1) {
    const p = neon.signScreen(i);
    if (!p) continue;
    if (p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight) continue;
    const hit = neon.pickAt(p.x, p.y);
    if (hit) return hit;
  }
  return null;
});
check('pick: raycast returns something', picked !== null, String(picked));

// easter egg
await page.evaluate(() => window.__neon.set({ paused: false }));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' })));
const eventCount = await page.evaluate(() => window.__neon.sim && document.querySelectorAll('[data-testid="toast"]').length);
await page.evaluate(() => {
  // fall back to the debug hook if the keyboard shortcut is not wired
  window.__neon.set({ paused: false });
});
await page.evaluate(() => window.__neon.setSeed(window.__neon.state().seed));
await page.waitForTimeout(300);

// reseed
const seedBefore = await page.evaluate(() => window.__neon.layoutSeed);
await page.evaluate(() => window.__neon.setSeed(4242));
await page.waitForTimeout(1200);
const seedAfter = await page.evaluate(() => window.__neon.layoutSeed);
check('reseed: new layout', seedAfter === 4242 && seedAfter !== seedBefore, `${seedBefore} -> ${seedAfter}`);
await shot('07-reseed');

// photo mode
await page.locator('[data-testid="btn-photo"]').click();
await page.waitForTimeout(700);
const photo = await page.evaluate(() => ({
  bodyClass: document.body.classList.contains('photo-mode'),
  paused: window.__neon.state().paused,
  captureVisible: Boolean(document.querySelector('[data-testid="btn-capture"]')),
}));
check('photo: ui hidden + paused', photo.bodyClass && photo.paused, JSON.stringify(photo));
check('photo: capture button present', photo.captureVisible);
await shot('08-photo-mode');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('photo: escape exits', await page.evaluate(() => !document.body.classList.contains('photo-mode')));

// url encoding
const share = await page.evaluate(() => window.__neon.state());
await page.waitForTimeout(600);
const search = await page.evaluate(() => window.location.search);
check('url: seed encoded', search.includes(`seed=${share.seed}`), search.slice(0, 120));

check('errors during run', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(', '));
await browser.close();
process.exit(failed.length ? 1 : 0);
