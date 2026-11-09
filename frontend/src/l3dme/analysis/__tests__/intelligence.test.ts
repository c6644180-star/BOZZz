import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeModel, classifyName, labelStateFor, type ModelPartInput } from '../intelligence'
import { hashModelFile } from '../hash'
import {
  confirmLabel,
  exportSidecar,
  importSidecar,
  loadSidecar,
  resetSidecar,
  setHidden,
  setNote,
} from '../sidecar'

function part(
  nodePath: string,
  min: [number, number, number],
  max: [number, number, number],
  name: string,
  triangles = 480,
): ModelPartInput {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  return {
    nodePath,
    parentPath: null,
    name,
    type: 'Mesh',
    extras: null,
    vertices: triangles * 3,
    triangles,
    bounds: { min, max },
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    bboxVolume: size[0] * size[1] * size[2],
    materialNames: [],
    depth: 0,
  }
}

function carParts(): ModelPartInput[] {
  return [
    part('Vehicle/Group_1#0', [0, 1, 0], [10, 4, 20], 'Group_1', 12_000),
    part('Vehicle/Mesh_001#1', [0.5, 0.3, 1], [2.5, 2.3, 3], 'Mesh_001'),
    part('Vehicle/Mesh_002#2', [7.5, 0.3, 1], [9.5, 2.3, 3], 'Mesh_002'),
    part('Vehicle/Mesh_003#3', [0.5, 0.3, 17], [2.5, 2.3, 19], 'Mesh_003'),
    part('Vehicle/Mesh_004#4', [7.5, 0.3, 17], [9.5, 2.3, 19], 'Mesh_004'),
  ]
}

function analyse(parts = carParts()) {
  return analyzeModel({
    hash: 'test-hash',
    fileName: 'car-like.glb',
    parts,
    bounds: { min: [0, 0, 0], max: [10, 5, 20] },
    center: [5, 2.5, 10],
    analysisMs: 42,
    now: 1_700_000_000_000,
  })
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  })
})

describe('name quality', () => {
  it('flags the exporter-default names from the brief', () => {
    for (const name of ['Mesh_001', 'Object_003', 'Group_1', 'polySurface12', 'Cube.004']) {
      expect(classifyName(name).quality).toBe('generic')
    }
  })

  it('keeps descriptive names as meaningful and short labels as weak', () => {
    expect(classifyName('front-left wheel').quality).toBe('meaningful')
    expect(classifyName('x').quality).toBe('weak')
    expect(classifyName('').quality).toBe('generic')
  })
})

describe('model analysis', () => {
  it('finds four near-identical round parts at the bottom corners', () => {
    const analysis = analyse()
    const wheel = analysis.parts.find((item) => item.name === 'Mesh_001')
    expect(wheel).toBeDefined()
    expect(wheel?.nameQuality).toBe('generic')
    expect(wheel?.suggestion?.label).toBe('Possible wheel')
    expect(wheel?.nearIdentical.count).toBe(4)
    expect(wheel?.suggestion?.reasons.join(' ')).toMatch(/4 near-identical parts/)
    expect(wheel?.mirrorPartner?.axis).toBe('x')
    expect(analysis.assembly.mirroredPairs.length).toBe(2)
    expect(analysis.assembly.duplicateGroups[0]?.count).toBe(4)
    expect(analysis.genericParts).toBe(5)
    expect(analysis.totals.triangles).toBe(12_000 + 480 * 4)
  })

  it('suggests a body for the largest top-level node', () => {
    const body = analyse().parts.find((item) => item.name === 'Group_1')
    expect(body?.suggestion?.label).toBe('Possible body or shell')
    expect(body?.suggestion?.source).toBe('hierarchy')
  })

  it('never treats a suggestion as confirmed', () => {
    const wheel = analyse().parts.find((item) => item.name === 'Mesh_001')!
    expect(labelStateFor(wheel, undefined).state).toBe('suggested')
    expect(labelStateFor(wheel, 'front-left wheel').state).toBe('confirmed')
    expect(labelStateFor(wheel, 'front-left wheel').displayName).toBe('front-left wheel')
  })

  it('reports no suggestion when no rule matches', () => {
    const parts = [part('Root/Cube#0', [0, 0, 0], [1, 1, 1], 'Cube')]
    const analysis = analyse(parts)
    expect(analysis.parts[0].suggestion).toBeNull()
    expect(labelStateFor(analysis.parts[0], undefined).state).toBe('unknown')
  })
})

describe('sidecar persistence', () => {
  it('stores confirmed labels and notes keyed by hash and node path', () => {
    confirmLabel('hash-a', 'car.glb', 'Vehicle/Mesh_001#1', 'front-left wheel')
    setNote('hash-a', 'car.glb', 'Vehicle/Mesh_001#1', 'bolt pattern 5x114')
    setHidden('hash-a', 'car.glb', 'Vehicle/Mesh_004#4', true)
    const loaded = loadSidecar('hash-a', 'car.glb')
    expect(loaded.confirmedLabels['Vehicle/Mesh_001#1']).toBe('front-left wheel')
    expect(loaded.notes['Vehicle/Mesh_001#1']).toBe('bolt pattern 5x114')
    expect(loaded.hidden).toEqual(['Vehicle/Mesh_004#4'])
    expect(loadSidecar('hash-b', 'car.glb').confirmedLabels).toEqual({})
  })

  it('survives export and import and rejects a different hash', () => {
    confirmLabel('hash-a', 'car.glb', 'Vehicle/Mesh_001#1', 'front-left wheel')
    const json = exportSidecar(loadSidecar('hash-a', 'car.glb'))
    resetSidecar('hash-a')
    expect(loadSidecar('hash-a', 'car.glb').confirmedLabels).toEqual({})
    const restored = importSidecar(json, 'hash-a', 'car.glb')
    expect(restored.confirmedLabels['Vehicle/Mesh_001#1']).toBe('front-left wheel')
    const foreign = importSidecar(json, 'hash-b', 'car.glb')
    expect(foreign.confirmedLabels).toEqual({})
  })
})

describe('file hash', () => {
  it('is stable for identical bytes and different for a changed byte', async () => {
    const a = new TextEncoder().encode('glTF model bytes').buffer
    const b = new TextEncoder().encode('glTF model bytes').buffer
    const c = new TextEncoder().encode('glTF model bytez').buffer
    expect(await hashModelFile(a)).toBe(await hashModelFile(b))
    expect(await hashModelFile(a)).not.toBe(await hashModelFile(c))
  })
})
