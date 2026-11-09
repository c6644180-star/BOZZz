import type { ModelControlApi, ModelControlResult } from '../l3dme/modelControl'

export type HoloVisualMode = 'solid' | 'hologram' | 'wireframe' | 'transparent'

export interface HoloPartDetails {
  name: string
  type: string
  size: [number, number, number]
  triangles: number
}

export interface HoloModelApi extends ModelControlApi {
  setHoloMode(mode: HoloVisualMode): ModelControlResult
  hidePart(name: string): ModelControlResult
  isolatePart(name: string): ModelControlResult
  showAllParts(): ModelControlResult
  /** Eases the exploded view for the slider; the typed API stays exact. */
  previewExplode(value: number): void
  listParts(): HoloPartDetails[]
  getPartDetails(): HoloPartDetails | null
}

let active: HoloModelApi | null = null
const listeners = new Set<() => void>()

export function registerHoloModel(api: HoloModelApi): () => void {
  active = api
  listeners.forEach((listener) => listener())
  return () => {
    if (active === api) {
      active = null
      listeners.forEach((listener) => listener())
    }
  }
}

export function getHoloModel(): HoloModelApi | null {
  return active
}

export function subscribeHoloModel(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
