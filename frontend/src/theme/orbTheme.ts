import type { OrbQuality, ThemeName } from '../types/bozz'

export type OrbTintRole = 'bright' | 'mid' | 'dim' | 'faint' | 'hot'

export interface OrbPalette {
  background: number
  core: number
  coreDeep: number
  coreWhite: number
  cage: number
  cageDim: number
  ring: number
  shard: number
  ray: number
  dust: number
  floor: number
  flare: number
  bloomTint: number
  error: number
  errorHot: number
}

export const ORB_PALETTES: Record<ThemeName, OrbPalette> = {
  gold: {
    background: 0x07060a,
    core: 0xf5b800,
    coreDeep: 0x5a3a00,
    coreWhite: 0xfff6dc,
    cage: 0xffd34d,
    cageDim: 0xc98a00,
    ring: 0xffd34d,
    shard: 0xfff0b8,
    ray: 0xffffff,
    dust: 0xffcf5a,
    floor: 0xf5b800,
    flare: 0xfff0c0,
    bloomTint: 0xffc23a,
    error: 0xff5a4d,
    errorHot: 0xffc4c4,
  },
  cyan: {
    background: 0x02060c,
    core: 0x2bb8f0,
    coreDeep: 0x053245,
    coreWhite: 0xeafaff,
    cage: 0x8fe3ff,
    cageDim: 0x1b8dc4,
    ring: 0x8fe3ff,
    shard: 0xd8f6ff,
    ray: 0xffffff,
    dust: 0x7fdcff,
    floor: 0x2bb8f0,
    flare: 0xeafaff,
    bloomTint: 0x2bb8f0,
    error: 0xff6b6b,
    errorHot: 0xffc4c4,
  },
}

export function orbPalette(theme: ThemeName): OrbPalette {
  return ORB_PALETTES[theme]
}

export interface OrbQualityProfile {
  pixelRatio: number
  fps: number
  antialias: boolean
  bloom: boolean
  coreDetail: number
  cageDetail: number
  shards: number
  rays: number
  dust: number
  dustSize: number
  ringSegments: number
}

export type OrbRenderQuality = OrbQuality | 'mini'

export const ORB_QUALITY: Record<OrbRenderQuality, OrbQualityProfile> = {
  // Floating 120 px window: two line shells, no bloom, no post-processing,
  // 30 fps and a 1x pixel ratio to stay light on an i3/8 GB laptop.
  mini: {
    pixelRatio: 1,
    fps: 30,
    antialias: false,
    bloom: false,
    coreDetail: 1,
    cageDetail: 0,
    shards: 4,
    rays: 4,
    dust: 0,
    dustSize: 0.05,
    ringSegments: 64,
  },
  low: {
    pixelRatio: 1,
    fps: 30,
    antialias: false,
    bloom: false,
    coreDetail: 1,
    cageDetail: 0,
    shards: 10,
    rays: 7,
    dust: 90,
    dustSize: 0.05,
    ringSegments: 96,
  },
  medium: {
    pixelRatio: 1.25,
    fps: 60,
    antialias: true,
    bloom: true,
    coreDetail: 2,
    cageDetail: 1,
    shards: 22,
    rays: 12,
    dust: 320,
    dustSize: 0.045,
    ringSegments: 150,
  },
  high: {
    pixelRatio: 1.5,
    fps: 60,
    antialias: true,
    bloom: true,
    coreDetail: 3,
    cageDetail: 1,
    shards: 40,
    rays: 18,
    dust: 620,
    dustSize: 0.04,
    ringSegments: 200,
  },
}
