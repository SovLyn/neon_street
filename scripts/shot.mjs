// Headless screenshot + debug probe for local verification.
// Usage: node scripts/shot.mjs <out.png> [url] [waitMs] [width] [height]
import { chromium } from 'playwright';

const [out = 'shot.png', url = 'http://localhost:4173/', waitMs = '2500', width = '1440', height = '900'] =
  process.argv.slice(2);

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
let ready = false;
try {
  await page.waitForFunction(() => window.__neon?.ready === true, null, { timeout: 30000 });
  ready = true;
} catch {
  console.log('NOT READY');
  console.log(await page.evaluate(() => document.getElementById('boot')?.innerText ?? '(no boot node)'));
}
await page.waitForTimeout(Number(waitMs));
const info = await page.evaluate(() => {
  const d = window.__neon;
  if (!d) return { debug: false };
  return { sample: d.sample(), sim: d.sim(), state: d.state(), frames: d.frame };
});
if (ready) {
  await page.screenshot({ path: out });
  console.log(`screenshot: ${out}`);
}
console.log(JSON.stringify(info));
if (errors.length) console.log(`ERRORS:\n${errors.join('\n')}`);
await browser.close();
process.exit(ready ? 0 : 1);
