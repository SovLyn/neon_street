import type { ThemeId, ThemePalette } from '../types';

/**
 * Neon color palettes. `neon[0..3]` is indexed by `colorIndex % 4` on buildings,
 * signs and props, so a theme switch recolors the whole block coherently.
 */
export const THEMES: Record<ThemeId, ThemePalette> = {
  synthwave: {
    id: 'synthwave',
    name: 'Synthwave',
    nameZh: '合成波',
    neon: ['#ff2d95', '#00e5ff', '#b46bff', '#ffd166'],
    accent: '#ff2d95',
    accent2: '#00e5ff',
    skyTop: '#07020f',
    skyHorizon: '#3b0f57',
    skyBottom: '#0b0620',
    fogColor: '#1b0a2e',
    fogDensity: 0.0042,
    ground: '#120a1f',
    asphalt: '#141019',
    sidewalk: '#241b30',
    buildingBase: '#191224',
    buildingTrim: '#2b2140',
    windowWarm: '#ffb86b',
    windowCool: '#7ce7ff',
    ambient: '#3a2a5a',
    keyLight: '#ff6ad5',
    fillLight: '#3ad8ff',
    water: '#0b1026',
    waterDeep: '#04060f',
    bloom: { strength: 0.72, radius: 0.35, threshold: 0.42 },
    exposure: 1.05,
    saturate: 1.08,
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    nameZh: '赛博黄',
    neon: ['#f9f002', '#00fff0', '#ff2a6d', '#ff8f1f'],
    accent: '#f9f002',
    accent2: '#ff2a6d',
    skyTop: '#03060c',
    skyHorizon: '#123040',
    skyBottom: '#05070d',
    fogColor: '#0d1a22',
    fogDensity: 0.0048,
    ground: '#0c1014',
    asphalt: '#101418',
    sidewalk: '#1c2226',
    buildingBase: '#12181c',
    buildingTrim: '#22303a',
    windowWarm: '#ffd08a',
    windowCool: '#9ff8ff',
    ambient: '#25343c',
    keyLight: '#f9f002',
    fillLight: '#00fff0',
    water: '#08131a',
    waterDeep: '#02070a',
    bloom: { strength: 0.8, radius: 0.34, threshold: 0.4 },
    exposure: 1.02,
    saturate: 1.15,
  },
  tokyo: {
    id: 'tokyo',
    name: 'Tokyo Night',
    nameZh: '东京夜',
    neon: ['#7aa2ff', '#ff7ac6', '#8affd6', '#ffd6a5'],
    accent: '#7aa2ff',
    accent2: '#ff7ac6',
    skyTop: '#040711',
    skyHorizon: '#152747',
    skyBottom: '#070b17',
    fogColor: '#101a2e',
    fogDensity: 0.004,
    ground: '#0a0f1a',
    asphalt: '#0f1420',
    sidewalk: '#1a2130',
    buildingBase: '#111827',
    buildingTrim: '#1f2b40',
    windowWarm: '#ffcf9c',
    windowCool: '#a9c7ff',
    ambient: '#22304a',
    keyLight: '#7aa2ff',
    fillLight: '#ff7ac6',
    water: '#071427',
    waterDeep: '#02060f',
    bloom: { strength: 0.68, radius: 0.38, threshold: 0.44 },
    exposure: 1.08,
    saturate: 1.02,
  },
  toxic: {
    id: 'toxic',
    name: 'Toxic',
    nameZh: '毒性绿',
    neon: ['#a8ff3e', '#39ff14', '#fffb00', '#00ffa3'],
    accent: '#a8ff3e',
    accent2: '#00ffa3',
    skyTop: '#020a05',
    skyHorizon: '#1b3a15',
    skyBottom: '#040d07',
    fogColor: '#0d1f11',
    fogDensity: 0.005,
    ground: '#08120b',
    asphalt: '#0d1410',
    sidewalk: '#17251c',
    buildingBase: '#0f1a13',
    buildingTrim: '#1e3326',
    windowWarm: '#c9ff9a',
    windowCool: '#7dffb0',
    ambient: '#1f3a24',
    keyLight: '#a8ff3e',
    fillLight: '#00ffa3',
    water: '#05170f',
    waterDeep: '#010805',
    bloom: { strength: 0.85, radius: 0.32, threshold: 0.38 },
    exposure: 1.0,
    saturate: 1.18,
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura',
    nameZh: '樱花雪',
    neon: ['#ff9ecb', '#c6a0ff', '#8ce8ff', '#ffe6a3'],
    accent: '#ff9ecb',
    accent2: '#c6a0ff',
    skyTop: '#0a0714',
    skyHorizon: '#3a2440',
    skyBottom: '#120c1c',
    fogColor: '#241a2c',
    fogDensity: 0.0045,
    ground: '#141020',
    asphalt: '#171320',
    sidewalk: '#28202f',
    buildingBase: '#1a1526',
    buildingTrim: '#33283f',
    windowWarm: '#ffd7b0',
    windowCool: '#bfe6ff',
    ambient: '#3a2d46',
    keyLight: '#ff9ecb',
    fillLight: '#c6a0ff',
    water: '#131022',
    waterDeep: '#05040c',
    bloom: { strength: 0.7, radius: 0.4, threshold: 0.44 },
    exposure: 1.06,
    saturate: 1.04,
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function getTheme(id: ThemeId | string): ThemePalette {
  return THEMES[(id as ThemeId) in THEMES ? (id as ThemeId) : 'synthwave'];
}

export interface Preset {
  id: string;
  name: string;
  nameZh: string;
  patch: {
    timeOfDay: number;
    rain: number;
    snow: number;
    fog: number;
    themeId: ThemeId;
    autoCycle: boolean;
  };
}

export const PRESETS: Preset[] = [
  {
    id: 'neon-rain',
    name: 'Neon Rain',
    nameZh: '雨夜霓虹',
    patch: { timeOfDay: 22.3, rain: 0.85, snow: 0, fog: 0.62, themeId: 'cyberpunk', autoCycle: false },
  },
  {
    id: 'violet-dusk',
    name: 'Violet Dusk',
    nameZh: '紫色黄昏',
    patch: { timeOfDay: 18.4, rain: 0.12, snow: 0, fog: 0.32, themeId: 'synthwave', autoCycle: false },
  },
  {
    id: 'rainy-dawn',
    name: 'Rainy Dawn',
    nameZh: '雨后黎明',
    patch: { timeOfDay: 6.1, rain: 0.3, snow: 0, fog: 0.5, themeId: 'tokyo', autoCycle: false },
  },
  {
    id: 'snow-night',
    name: 'Snow Night',
    nameZh: '雪夜',
    patch: { timeOfDay: 23.6, rain: 0, snow: 0.78, fog: 0.55, themeId: 'sakura', autoCycle: false },
  },
];
