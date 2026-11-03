// Render a set of camera compositions for visual review.
// Usage: node scripts/explore.mjs <url> <outPrefix> "px,py,pz,tx,ty,tz" ...
import { chromium } from 'playwright';

const [url, prefix, ...cams] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__neon?.ready === true, null, { timeout: 30000 });
await page.waitForTimeout(2000);
let index = 0;
for (const spec of cams.length ? cams : ['46,18,58,-2,8,-6']) {
  const [px, py, pz, tx, ty, tz] = spec.split(',').map(Number);
  await page.evaluate(([a, b, c, d, e, f]) => window.__neon.setCamera(a, b, c, d, e, f), [px, py, pz, tx, ty, tz]);
  await page.waitForTimeout(900);
  const out = `${prefix}-${index}.png`;
  await page.screenshot({ path: out });
  console.log(`${out}  cam ${spec}`);
  index += 1;
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
