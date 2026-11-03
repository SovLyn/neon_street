import { expect, test, type Page } from '@playwright/test';

interface NeonState {
  timeOfDay: number;
  signText?: string;
  rain: number;
  themeId: string;
  autoCycle: boolean;
}

interface SimInfo {
  timeOfDay: number;
  cars: number;
  peds: number;
  signFlashSum: number;
  lampOn: number;
  waterSum: number;
  env: number[];
}

interface SampleInfo {
  calls: number;
  meanLuma: number;
  uniqueColors: number;
}

async function gotoApp(page: Page, search = ''): Promise<void> {
  await page.goto(`/${search}`);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__neon?.ready)), { timeout: 40_000 }).toBe(true);
  // Software WebGL on CI runners is slow; give the first frames room to happen.
  await expect.poll(async () => page.evaluate(() => window.__neon?.frame ?? 0), { timeout: 40_000 }).toBeGreaterThan(5);
  await page.evaluate(() => window.__neon?.set({ autoCycle: false }));
}

async function state(page: Page): Promise<NeonState> {
  return page.evaluate(() => {
    if (!window.__neon) throw new Error('NEON debug API is unavailable');
    return window.__neon.state();
  });
}

async function simInfo(page: Page): Promise<SimInfo> {
  return page.evaluate(() => {
    if (!window.__neon) throw new Error('NEON debug API is unavailable');
    return window.__neon.sim();
  });
}

test('wasm 初始化', async ({ page }) => {
  await gotoApp(page);
  await expect.poll(async () => page.evaluate(() => window.__neon?.wasmBytes ?? 0)).toBeGreaterThan(50_000);
  const info = await simInfo(page);
  expect(info.env).toHaveLength(8);
});

test('时间滑块改变状态', async ({ page }) => {
  await gotoApp(page);
  const time = page.locator('#neon-time');
  const setTime = async (value: string) => {
    await time.evaluate((element, next) => {
      const input = element as HTMLInputElement;
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await expect.poll(async () => (await state(page)).timeOfDay).toBeCloseTo(Number(value), 1);
  };

  await setTime('12');
  const litAtNoon = (await simInfo(page)).env[4];
  await setTime('23');
  const litAtNight = (await simInfo(page)).env[4];

  expect(litAtNoon).toBeLessThan(0.5);
  expect(litAtNight).toBeGreaterThan(litAtNoon + 0.25);
});

test('配色切换生效', async ({ page }) => {
  await gotoApp(page);
  const toxic = page.locator('[data-theme-id="toxic"]');
  await toxic.click();
  await expect.poll(async () => (await state(page)).themeId).toBe('toxic');
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe('toxic');
  await expect.poll(async () => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').trim())).toBe('#a8ff3e');
  await expect.poll(async () => toxic.evaluate((element) => {
    const button = element as HTMLElement;
    return button.classList.contains('active') || button.classList.contains('selected') ||
      button.getAttribute('aria-pressed') === 'true' || button.getAttribute('data-active') === 'true';
  })).toBe(true);
});

test('点击交互有反馈', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__neon?.clickSign(0));
  await expect.poll(async () => (await simInfo(page)).signFlashSum).toBeGreaterThan(0.3);
  await expect.poll(async () => page.locator('[data-testid="toast"]').textContent()).not.toBe('');

  const lampBefore = (await simInfo(page)).lampOn;
  await page.evaluate(() => window.__neon?.clickLamp(0));
  await expect.poll(async () => (await simInfo(page)).lampOn).toBe(lampBefore === 0 ? 1 : lampBefore - 1);

  const waterBefore = (await simInfo(page)).waterSum;
  await page.evaluate(() => window.__neon?.clickWater(30, 40));
  await expect.poll(async () => (await simInfo(page)).waterSum).toBeGreaterThan(waterBefore);
});

test('URL 状态可恢复', async ({ page }) => {
  await gotoApp(page, '?seed=42&t=5.5&rain=0.9&theme=tokyo');
  await expect.poll(async () => (await state(page)).timeOfDay).toBeCloseTo(5.5, 1);
  await expect.poll(async () => (await state(page)).rain).toBeCloseTo(0.9, 1);
  await expect.poll(async () => (await state(page)).themeId).toBe('tokyo');
  await expect.poll(async () => page.evaluate(() => window.__neon?.layoutSeed)).toBe(42);

  await page.locator('details.section-block > summary').click();
  await expect(page.locator('[data-testid="btn-share"]')).toBeVisible();
  await page.locator('[data-testid="btn-share"]').click();
  const search = await page.evaluate(() => window.location.search);
  const params = new URLSearchParams(search);
  expect(params.get('seed')).toBe('42');
  expect(params.get('theme')).toBe('tokyo');
});

test('关键操作在首屏可点（无需滚动）', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await gotoApp(page);
    for (const id of ['btn-reseed', 'btn-share', 'btn-photo', 'btn-event', 'btn-reset-camera']) {
      const box = await page.locator(`[data-testid="${id}"]`).boundingBox();
      expect(box, `${id} is missing`).not.toBeNull();
      expect(box!.y + box!.height, `${id} is below the fold at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.height);
      expect(box!.y, `${id} starts above the viewport`).toBeGreaterThanOrEqual(0);
    }
  }
});

test('悬停可交互物时有提示', async ({ page }) => {
  await gotoApp(page, '?auto=0&t=21.4');
  const point = await page.evaluate(() => {
    for (let i = 0; i < 24; i += 1) {
      const spot = window.__neon?.signScreen(i);
      if (spot && spot.x > 470 && spot.y > 120 && spot.y < window.innerHeight - 120) return spot;
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  await expect.poll(async () => page.locator('.hover-label').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(page.locator('.hover-label')).toContainText('招牌');
  await page.mouse.move(4, 4);
  await expect.poll(async () => page.locator('.hover-label').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
});

test('彩蛋会写进事件日志', async ({ page }) => {
  await gotoApp(page, '?auto=0&t=22');
  await page.evaluate(() => window.__neon?.triggerEvent());
  await expect.poll(async () => (await page.locator('[data-testid="event-log"]').textContent()) ?? '').not.toBe('');
});

test('自定义招牌文字写进 URL', async ({ page }) => {
  await gotoApp(page, '?auto=0&t=21.4');
  await page.locator('details.section-block > summary').click();
  const input = page.locator('[data-testid="sign-input"]');
  await input.fill('霓虹万岁');
  await expect.poll(async () => (await state(page)).signText).toBe('霓虹万岁');
  await expect.poll(async () =>
    new URLSearchParams(await page.evaluate(() => window.location.search)).get('sign'),
  ).toBe('霓虹万岁');
});

test('canvas 有渲染输出', async ({ page }) => {
  await gotoApp(page);
  await expect.poll(async () => page.evaluate(() => window.__neon?.sample().calls ?? 0)).toBeGreaterThan(10);
  const sample = await page.evaluate(() => window.__neon?.sample() as SampleInfo);
  expect(sample.meanLuma).toBeGreaterThan(5);
  expect(sample.uniqueColors).toBeGreaterThan(20);
  const shot = await page.evaluate(() => window.__neon?.shot() ?? '');
  expect(shot.startsWith('data:image/png;base64,')).toBe(true);
  expect(shot.length).toBeGreaterThan(20_000);
});
