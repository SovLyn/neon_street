import './ui.css';
import { PRESETS, THEMES, getTheme } from '../theme/palettes';
import type { ThemeId } from '../types';
import type { AppState, Store } from '../state';
import type { SimBridge } from '../wasm/sim';
import { sanitizeSignText } from '../url';

export interface UiDeps {
  store: Store;
  sim: SimBridge;
  onReseed(seed: number): void;
  /** write the shareable URL and return it */
  onShare(): string;
  /** export the current frame as PNG */
  onCapture(): Promise<void>;
  onCameraReset(): void;
  onEvent(): void;
}

export interface UiHandle {
  refresh(): void;
  toast(message: string): void;
  pushEvent(text: string): void;
  dispose(): void;
}

type Cleanup = () => void;
type ToggleKey = 'bloom' | 'chromatic' | 'grain' | 'reflections';

const SHORTCUT_INPUTS = 'input, textarea, select';
const MAX_SEED = 0xffffffff;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatClock(hours: number): string {
  const normalized = ((hours % 24) + 24) % 24;
  const totalMinutes = Math.round(normalized * 60) % (24 * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatEventTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function timePeriod(hours: number): string {
  const normalized = ((hours % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 8) return '黎明';
  if (normalized >= 8 && normalized < 17) return '白天';
  if (normalized >= 17 && normalized < 20) return '黄昏';
  return '夜晚';
}

function randomSeed(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] ?? 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * MAX_SEED)) >>> 0;
}

function describePercent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function addText(parent: Element, tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function addButton(parent: Element, className: string, label: string, ariaLabel?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  parent.append(button);
  return button;
}

function addRange(
  parent: Element,
  id: string,
  min: string,
  max: string,
  step: string,
  ariaLabel: string,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = min;
  input.max = max;
  input.step = step;
  input.setAttribute('aria-label', ariaLabel);
  parent.append(input);
  return input;
}

function addDetails(parent: Element, key: string, title: string, detail?: string): HTMLElement {
  const details = document.createElement('details');
  details.className = `control-section section-${key}`;
  details.open = key === 'time' || key === 'weather' || key === 'theme';
  const summary = document.createElement('summary');
  summary.className = 'section-summary';
  const summaryTitle = addText(summary, 'span', 'section-title', title);
  summaryTitle.setAttribute('aria-hidden', 'true');
  if (detail) addText(summary, 'span', 'section-detail', detail);
  details.append(summary);
  parent.append(details);
  return details;
}

function addFieldLabel(parent: Element, label: string, value?: string): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'field-label';
  addText(row, 'span', 'field-name', label);
  if (value) addText(row, 'span', 'field-value', value);
  parent.append(row);
  return row;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(SHORTCUT_INPUTS));
}

export function mountUI(deps: UiDeps): UiHandle {
  const hud = document.getElementById('hud');
  if (!hud) {
    return {
      refresh: () => undefined,
      toast: () => undefined,
      pushEvent: (_text: string) => undefined,
      dispose: () => undefined,
    };
  }

  hud.replaceChildren();
  const cleanups: Cleanup[] = [];
  const on = <T extends EventTarget>(target: T, event: string, listener: EventListener, options?: AddEventListenerOptions): void => {
    target.addEventListener(event, listener, options);
    cleanups.push(() => target.removeEventListener(event, listener, options));
  };

  const root = document.createElement('div');
  root.className = 'neon-ui';
  root.setAttribute('aria-label', '霓虹街区控制界面');
  hud.append(root);

  const brand = document.createElement('section');
  brand.className = 'neon-brand glass-panel';
  brand.setAttribute('aria-label', '场景信息');
  root.append(brand);
  const brandTop = document.createElement('div');
  brandTop.className = 'brand-topline';
  brand.append(brandTop);
  addText(brandTop, 'span', 'brand-kicker', 'NEON STREET / 霓虹街区');
  const livePill = addText(brandTop, 'span', 'live-pill', 'LIVE');
  livePill.setAttribute('aria-label', '场景运行中');
  addText(brand, 'h1', 'brand-title', '霓虹街区');
  addText(brand, 'p', 'brand-subtitle', '雨落在光里，街区由种子生长');
  const brandStats = document.createElement('div');
  brandStats.className = 'brand-stats';
  brand.append(brandStats);
  const seedReadout = addText(brandStats, 'span', 'stat-chip', 'SEED —');
  const fpsReadout = addText(brandStats, 'span', 'stat-chip', 'FPS —');
  const clockReadout = addText(brandStats, 'span', 'clock-readout', '21:24');
  const eventLog = document.createElement('div');
  eventLog.className = 'event-log';
  eventLog.dataset.testid = 'event-log';
  eventLog.setAttribute('role', 'log');
  eventLog.setAttribute('aria-live', 'polite');
  brand.append(eventLog);

  const dock = document.createElement('section');
  dock.className = 'control-dock glass-panel';
  dock.setAttribute('aria-label', '街区控制台');
  root.append(dock);
  const dockHead = document.createElement('div');
  dockHead.className = 'dock-head';
  dock.append(dockHead);
  const dockHeading = document.createElement('div');
  dockHeading.className = 'dock-heading';
  dockHead.append(dockHeading);
  addText(dockHeading, 'span', 'dock-eyebrow', 'CITY CONTROL / 01');
  addText(dockHeading, 'strong', 'dock-title', '街区控制台');
  const dockMeta = document.createElement('div');
  dockMeta.className = 'dock-meta';
  dockHead.append(dockMeta);
  const pauseButton = addButton(dockMeta, 'icon-button pause-button', 'Ⅱ', '暂停或继续模拟');
  const shortcutHint = addText(dockMeta, 'span', 'shortcut-hint', 'SPACE 暂停 · H 隐藏');

  const dockMiddle = document.createElement('div');
  dockMiddle.className = 'dock-middle';
  dock.append(dockMiddle);
  const sections = document.createElement('div');
  sections.className = 'control-sections';
  dockMiddle.append(sections);

  const timeSection = addDetails(sections, 'time', '时间', 'TIME');
  const timeLabelRow = document.createElement('div');
  timeLabelRow.className = 'value-row';
  timeSection.append(timeLabelRow);
  const timeValue = addText(timeLabelRow, 'strong', 'primary-value', '21:24 · 夜晚');
  addText(timeLabelRow, 'span', 'range-unit', 'LOCAL TIME');
  const timeRange = addRange(timeSection, 'neon-time', '0', '24', '0.1', '时间，0 到 24 小时');
  const timeTicks = document.createElement('div');
  timeTicks.className = 'range-ticks';
  timeTicks.append('00:00', '06:00', '12:00', '18:00', '24:00');
  timeSection.append(timeTicks);
  const timeOptions = document.createElement('div');
  timeOptions.className = 'inline-controls';
  timeSection.append(timeOptions);
  const autoLabel = document.createElement('label');
  autoLabel.className = 'switch-line';
  const autoToggle = document.createElement('input');
  autoToggle.type = 'checkbox';
  autoToggle.setAttribute('aria-label', '自动循环时间');
  autoLabel.append(autoToggle);
  addText(autoLabel, 'span', 'switch-track', '');
  addText(autoLabel, 'span', 'switch-copy', '自动循环');
  timeOptions.append(autoLabel);
  const speedWrap = document.createElement('label');
  speedWrap.className = 'speed-control';
  addText(speedWrap, 'span', 'speed-name', '速度');
  const speedRange = addRange(speedWrap, 'neon-speed', '0.05', '1.5', '0.01', '自动循环速度');
  const speedValue = addText(speedWrap, 'output', 'speed-value', '0.28×');
  timeOptions.append(speedWrap);

  const weatherSection = addDetails(sections, 'weather', '天气', 'WEATHER');
  const weatherRows: Array<{ input: HTMLInputElement; output: HTMLElement; key: 'rain' | 'snow' | 'fog' }> = [];
  for (const item of [
    ['rain', '雨', 'neon-rain'],
    ['snow', '雪', 'neon-snow'],
    ['fog', '雾', 'neon-fog'],
  ] as const) {
    const row = document.createElement('label');
    row.className = 'meter-row';
    addText(row, 'span', 'meter-name', item[1]);
    const input = addRange(row, item[2], '0', '1', '0.01', `${item[1]}强度`);
    const output = addText(row, 'output', 'meter-value', '0%');
    weatherSection.append(row);
    weatherRows.push({ input, output, key: item[0] });
  }

  const themeSection = addDetails(sections, 'theme', '配色', 'PALETTE');
  const themeGrid = document.createElement('div');
  themeGrid.className = 'theme-grid';
  themeSection.append(themeGrid);
  const themeButtons = new Map<ThemeId, HTMLButtonElement>();
  for (const theme of Object.values(THEMES)) {
    const button = addButton(themeGrid, 'theme-swatch', '', `切换配色：${theme.nameZh}`);
    button.dataset.themeId = theme.id;
    button.style.setProperty('--swatch-a', theme.neon[0]);
    button.style.setProperty('--swatch-b', theme.neon[1]);
    button.style.setProperty('--swatch-c', theme.neon[2]);
    button.style.setProperty('--swatch-d', theme.neon[3]);
    const dots = document.createElement('span');
    dots.className = 'swatch-dots';
    for (let index = 0; index < theme.neon.length; index += 1) {
      const dot = document.createElement('i');
      dot.style.setProperty('--dot-color', theme.neon[index]);
      dots.append(dot);
    }
    button.append(dots);
    addText(button, 'span', 'swatch-name', theme.nameZh);
    addText(button, 'span', 'swatch-name-en', theme.name);
    themeButtons.set(theme.id, button);
  }

  const presetSection = addDetails(sections, 'preset', '预设', 'SCENES');
  const presetGrid = document.createElement('div');
  presetGrid.className = 'preset-grid';
  presetSection.append(presetGrid);
  const presetButtons = new Map<string, HTMLButtonElement>();
  for (const preset of PRESETS) {
    const button = addButton(presetGrid, 'preset-button', preset.nameZh, `应用预设：${preset.nameZh}`);
    button.dataset.presetId = preset.id;
    addText(button, 'span', 'preset-name-en', preset.name);
    presetButtons.set(preset.id, button);
  }

  const blockSection = addDetails(sections, 'block', '街区', 'BLOCK');
  const seedLine = document.createElement('div');
  seedLine.className = 'seed-line';
  blockSection.append(seedLine);
  const seedField = document.createElement('label');
  seedField.className = 'seed-field';
  addText(seedField, 'span', 'field-name', '种子');
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.autocomplete = 'off';
  seedInput.spellcheck = false;
  seedInput.dataset.testid = 'seed-input';
  seedInput.setAttribute('aria-label', '街区种子');
  seedField.append(seedInput);
  seedLine.append(seedField);
  const signField = document.createElement('label');
  signField.className = 'seed-field';
  addText(signField, 'span', 'field-name', '招牌字');
  const signInput = document.createElement('input');
  signInput.type = 'text';
  signInput.maxLength = 8;
  signInput.autocomplete = 'off';
  signInput.spellcheck = false;
  signInput.placeholder = '最多 8 字';
  signInput.dataset.testid = 'sign-input';
  signInput.setAttribute('aria-label', '自定义地标招牌文字');
  signField.append(signInput);
  blockSection.append(signField);
  signInput.addEventListener('input', () => {
    deps.store.set({ signText: sanitizeSignText(signInput.value) });
  });
  for (const field of [seedInput, signInput]) {
    field.addEventListener('focus', () => field.scrollIntoView({ block: 'nearest' }));
  }

  const qualitySection = addDetails(sections, 'quality', '画质', 'FX');
  const qualityGrid = document.createElement('div');
  qualityGrid.className = 'quality-grid';
  qualitySection.append(qualityGrid);
  const toggleInputs = new Map<ToggleKey, HTMLInputElement>();
  const toggleLabels: Array<[ToggleKey, string, string]> = [
    ['bloom', '泛光', 'BLOOM'],
    ['chromatic', '色散', 'CHROMA'],
    ['grain', '颗粒', 'GRAIN'],
    ['reflections', '反射', 'REFL'],
  ];
  for (const [key, label, short] of toggleLabels) {
    const labelNode = document.createElement('label');
    labelNode.className = 'quality-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.testid = `toggle-${key === 'chromatic' ? 'chroma' : key === 'reflections' ? 'refl' : key}`;
    input.setAttribute('aria-label', `${label}开关`);
    labelNode.append(input);
    addText(labelNode, 'span', 'quality-check', '');
    const copy = document.createElement('span');
    copy.className = 'quality-copy';
    addText(copy, 'strong', 'quality-name', label);
    addText(copy, 'small', 'quality-short', short);
    labelNode.append(copy);
    qualityGrid.append(labelNode);
    toggleInputs.set(key, input);
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'dock-actions';
  dock.append(actionBar);
  const reseedButton = addButton(actionBar, 'action-button action-primary', '换街', '换一条街');
  reseedButton.dataset.testid = 'btn-reseed';
  reseedButton.title = '换一条街';
  const shareButton = addButton(actionBar, 'action-button', '分享', '分享链接');
  shareButton.dataset.testid = 'btn-share';
  shareButton.title = '分享链接';
  const photoButton = addButton(actionBar, 'action-button action-photo photo-button', '摄影', '进入摄影模式');
  photoButton.dataset.testid = 'btn-photo';
  photoButton.title = '进入摄影模式';
  const eventButton = addButton(actionBar, 'action-button', '异常', '触发异常');
  eventButton.dataset.testid = 'btn-event';
  eventButton.title = '触发异常';
  const resetButton = addButton(actionBar, 'action-button', '机位', '重置机位');
  resetButton.dataset.testid = 'btn-reset-camera';
  resetButton.title = '重置机位';

  const toastStack = document.createElement('div');
  toastStack.className = 'toast-stack';
  toastStack.dataset.testid = 'toast';
  toastStack.setAttribute('role', 'status');
  toastStack.setAttribute('aria-live', 'polite');
  hud.append(toastStack);

  const photoOverlay = document.createElement('div');
  photoOverlay.className = 'photo-overlay';
  photoOverlay.setAttribute('aria-label', '摄影模式');
  // Must live inside .neon-ui: the photo-mode CSS rules are scoped to it.
  root.append(photoOverlay);
  const photoFrame = document.createElement('div');
  photoFrame.className = 'photo-frame';
  photoOverlay.append(photoFrame);
  const photoTools = document.createElement('div');
  photoTools.className = 'photo-tools';
  photoOverlay.append(photoTools);
  addText(photoTools, 'span', 'photo-label', 'PHOTO / 霓虹街区');
  const captureButton = addButton(photoTools, 'capture-button', '捕获画面', '导出当前画面为 PNG');
  captureButton.dataset.testid = 'btn-capture';
  addText(photoTools, 'span', 'photo-hint', 'ESC 退出');

  let timeDragging = false;
  let previousPaused: boolean | null = null;
  let capturing = false;
  let hudHidden = false;
  let fpsFrames = 0;
  let fpsStamp = performance.now();
  let fps = 0;
  let disposed = false;

  const active = (input: HTMLInputElement): boolean => document.activeElement === input || timeDragging;

  const setThemeAccent = (themeId: ThemeId): void => {
    const theme = getTheme(themeId);
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--accent-2', theme.accent2);
  };

  const refreshClock = (): void => {
    const state = deps.store.get();
    const hours = state.autoCycle ? deps.sim.timeOfDay : state.timeOfDay;
    const clock = formatClock(hours);
    clockReadout.textContent = clock;
    timeValue.textContent = `${clock} · ${timePeriod(hours)}`;
    if (!active(timeRange)) timeRange.value = String(clamp(hours, 0, 24));
  };

  const refresh = (): void => {
    if (disposed) return;
    const state = deps.store.get();
    seedReadout.textContent = `SEED ${state.seed >>> 0}`;
    if (!active(seedInput)) seedInput.value = String(state.seed >>> 0);
    if (!active(signInput)) signInput.value = state.signText;
    autoToggle.checked = state.autoCycle;
    speedRange.value = String(state.autoCycleSpeed);
    speedValue.textContent = `${state.autoCycleSpeed.toFixed(2)}×`;
    pauseButton.textContent = state.paused ? '▶' : 'Ⅱ';
    pauseButton.setAttribute('aria-label', state.paused ? '继续模拟' : '暂停模拟');
    root.classList.toggle('is-paused', state.paused);
    for (const item of weatherRows) {
      const value = state[item.key];
      if (!active(item.input)) item.input.value = String(value);
      item.output.textContent = describePercent(value);
    }
    for (const [key, input] of toggleInputs) input.checked = state[key];
    for (const [id, button] of themeButtons) {
      const selected = id === state.themeId;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const [id, button] of presetButtons) button.setAttribute('aria-pressed', 'false');
    root.classList.toggle('is-photo-mode', state.photoMode);
    setThemeAccent(state.themeId);
    refreshClock();
  };

  const enterPhotoMode = (): void => {
    const state = deps.store.get();
    if (state.photoMode) return;
    previousPaused = state.paused;
    deps.store.set({ photoMode: true, paused: true });
  };

  const exitPhotoMode = (): void => {
    const state = deps.store.get();
    if (!state.photoMode) return;
    const paused = previousPaused ?? state.paused;
    previousPaused = null;
    deps.store.set({ photoMode: false, paused });
  };

  const commitSeed = (): void => {
    const raw = seedInput.value.trim();
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SEED) {
      seedInput.value = String(deps.store.get().seed >>> 0);
      toast('种子无效 · 请输入 0–4294967295');
      return;
    }
    deps.onReseed(parsed >>> 0);
    toast(`街区已重构 · SEED ${parsed >>> 0}`);
  };

  const toast = (message: string): void => {
    const item = document.createElement('div');
    item.className = 'toast-item';
    item.textContent = message;
    toastStack.prepend(item);
    while (toastStack.children.length > 3) toastStack.lastElementChild?.remove();
    window.setTimeout(() => item.remove(), 2400);
  };

  const pushEvent = (text: string): void => {
    const timestamp = new Date();
    const item = document.createElement('div');
    item.className = 'event-log-line';
    const stamp = addText(item, 'time', 'event-log-time', formatEventTime(timestamp));
    stamp.setAttribute('datetime', timestamp.toISOString());
    addText(item, 'span', 'event-log-text', text);
    eventLog.prepend(item);
    while (eventLog.children.length > 3) eventLog.lastElementChild?.remove();
  };

  on(timeRange, 'pointerdown', () => {
    timeDragging = true;
    if (deps.store.get().autoCycle) deps.store.set({ autoCycle: false });
  });
  on(window, 'pointerup', () => {
    if (!timeDragging) return;
    timeDragging = false;
    refresh();
  });
  on(timeRange, 'input', () => {
    timeDragging = true;
    deps.store.set({ timeOfDay: clamp(Number(timeRange.value), 0, 24), autoCycle: false });
    refreshClock();
  });
  on(timeRange, 'change', () => {
    timeDragging = false;
    refresh();
  });
  on(speedRange, 'input', () => {
    deps.store.set({ autoCycleSpeed: clamp(Number(speedRange.value), 0.05, 1.5) });
  });
  on(autoToggle, 'change', () => {
    deps.store.set({ autoCycle: autoToggle.checked });
    toast(autoToggle.checked ? '时间循环已启动' : '时间循环已暂停');
  });
  for (const item of weatherRows) {
    on(item.input, 'input', () => {
      deps.store.set({ [item.key]: clamp(Number(item.input.value), 0, 1) });
    });
  }
  for (const [id, button] of themeButtons) {
    on(button, 'click', () => {
      deps.store.set({ themeId: id });
      toast(`配色切换 · ${THEMES[id].nameZh}`);
    });
  }
  for (const preset of PRESETS) {
    const button = presetButtons.get(preset.id);
    if (!button) continue;
    on(button, 'click', () => {
      deps.store.set(preset.patch);
      toast(`预设已应用 · ${preset.nameZh}`);
    });
  }
  on(seedInput, 'keydown', (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Enter') {
      keyboardEvent.preventDefault();
      commitSeed();
    }
  });
  on(seedInput, 'blur', () => {
    if (seedInput.value !== String(deps.store.get().seed >>> 0)) seedInput.value = String(deps.store.get().seed >>> 0);
  });
  on(reseedButton, 'click', commitSeed);
  on(shareButton, 'click', () => {
    const url = deps.onShare();
    toast(`分享链接已复制 · ${url}`);
  });
  on(eventButton, 'click', () => deps.onEvent());
  on(resetButton, 'click', () => {
    deps.onCameraReset();
    toast('机位已重置');
  });
  for (const [key, input] of toggleInputs) {
    on(input, 'change', () => deps.store.set({ [key]: input.checked }));
  }
  on(pauseButton, 'click', () => deps.store.set({ paused: !deps.store.get().paused }));
  on(photoButton, 'click', enterPhotoMode);
  on(captureButton, 'click', () => {
    if (capturing) return;
    capturing = true;
    captureButton.disabled = true;
    void deps.onCapture()
      .then(() => toast('画面已导出 · PNG'))
      .catch(() => toast('导出失败 · 请重试'))
      .finally(() => {
        capturing = false;
        captureButton.disabled = false;
      });
  });
  on(window, 'keydown', (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Escape') {
      exitPhotoMode();
      return;
    }
    if (isTextEntryTarget(keyboardEvent.target)) return;
    if (keyboardEvent.repeat && keyboardEvent.key !== ' ') return;
    switch (keyboardEvent.key.toLowerCase()) {
      case ' ':
        keyboardEvent.preventDefault();
        deps.store.set({ paused: !deps.store.get().paused });
        break;
      case 'p':
        enterPhotoMode();
        break;
      case 'h':
        hudHidden = !hudHidden;
        root.classList.toggle('is-hidden', hudHidden);
        toast(hudHidden ? 'HUD 已隐藏 · 按 H 恢复' : 'HUD 已显示');
        break;
      case 'r':
        deps.onReseed(randomSeed());
        toast('随机街区已生成');
        break;
      case 'c':
        if (deps.store.get().photoMode) captureButton.click();
        break;
      default:
        break;
    }
  });

  const storeUnsubscribe = deps.store.subscribe(() => refresh());
  cleanups.push(storeUnsubscribe);

  const sampleFps = (now: number): void => {
    if (disposed) return;
    fpsFrames += 1;
    if (now - fpsStamp >= 500) {
      fps = Math.round((fpsFrames * 1000) / (now - fpsStamp));
      fpsFrames = 0;
      fpsStamp = now;
      fpsReadout.textContent = `FPS ${fps}`;
    }
    requestAnimationFrame(sampleFps);
  };
  requestAnimationFrame(sampleFps);
  const clockTimer = window.setInterval(() => {
    if (!disposed) refreshClock();
  }, 250);
  cleanups.push(() => window.clearInterval(clockTimer));

  refresh();

  return {
    refresh,
    toast,
    pushEvent,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      hud.replaceChildren();
    },
  };
}

void (0 as unknown as Store);
void (0 as unknown as SimBridge);
void (0 as unknown as AppState);
