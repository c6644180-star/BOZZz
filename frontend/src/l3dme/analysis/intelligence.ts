// L3DME model intelligence. All values here come from the loaded file's real
// hierarchy and geometry. Geometry rules only ever produce suggestions.

export type NameQuality = 'meaningful' | 'weak' | 'generic'

export type LabelState = 'confirmed' | 'suggested' | 'unknown'

export interface BoundsInput {
  min: [number, number, number]
  max: [number, number, number]
}

export interface ModelPartInput {
  nodePath: string
  parentPath: string | null
  name: string
  type: string
  extras: Record<string, unknown> | null
  vertices: number
  triangles: number
  bounds: BoundsInput
  center: [number, number, number]
  /** Size of the axis-aligned bounding box. Not the true mesh volume. */
  bboxVolume: number
  materialNames: string[]
  depth: number
}

export interface LabelSuggestion {
  label: string
  confidence: number
  source: 'geometry' | 'pattern' | 'hierarchy'
  reasons: string[]
}

export interface ModelPartAnalysis {
  nodePath: string
  parentPath: string | null
  name: string
  type: string
  depth: number
  extras: Record<string, unknown> | null
  vertices: number
  triangles: number
  bounds: BoundsInput
  center: [number, number, number]
  bboxVolume: number
  size: [number, number, number]
  nameQuality: NameQuality
  nameReason: string
  children: string[]
  nearestNeighbours: Array<{ nodePath: string; distance: number }>
  mirrorPartner: { nodePath: string; axis: 'x' | 'y' | 'z' } | null
  nearIdentical: { count: number; nodePaths: string[] }
  suggestion: LabelSuggestion | null
}

export interface AssemblyAnalysis {
  rootParts: string[]
  mirroredPairs: Array<{ a: string; b: string; axis: 'x' | 'y' | 'z' }>
  duplicateGroups: Array<{ signature: string; count: number; nodePaths: string[] }>
}

export interface ModelAnalysis {
  version: 1
  createdAt: number
  hash: string
  fileName: string
  parts: ModelPartAnalysis[]
  assembly: AssemblyAnalysis
  totals: {
    parts: number
    vertices: number
    triangles: number
  }
  bounds: BoundsInput
  center: [number, number, number]
  genericParts: number
  warnings: string[]
  analysisMs: number
}

const GENERIC_PATTERNS = [
  /^mesh[._ -]?\d+$/i,
  /^object[._ -]?\d+$/i,
  /^group[._ -]?\d+$/i,
  /^node[._ -]?\d+$/i,
  /^polysurface\d+$/i,
  /^p[._ -]?\d+$/i,
  /^(cube|sphere|cylinder|plane|circle|cone|torus|box)[._ -]?\d+$/i,
  /^unnamed (mesh|part|node) \d+$/i,
]

export function classifyName(name: string): { quality: NameQuality; reason: string } {
  const trimmed = name.trim()
  if (!trimmed) return { quality: 'generic', reason: 'The node has no name in the file.' }
  if (GENERIC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      quality: 'generic',
      reason: `“${trimmed}” matches a default exporter name, so it does not describe the object.`,
    }
  }
  if (/^\d+$/.test(trimmed)) return { quality: 'generic', reason: 'The name is only a number.' }
  if (trimmed.length <= 2 || /^(part|node|object|mesh|group|thing)$/i.test(trimmed)) {
    return { quality: 'weak', reason: `“${trimmed}” carries no useful description.` }
  }
  return { quality: 'meaningful', reason: `“${trimmed}” is a descriptive name from the file.` }
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function sizeOf(part: ModelPartInput): [number, number, number] {
  return [
    Math.abs(part.bounds.max[0] - part.bounds.min[0]),
    Math.abs(part.bounds.max[1] - part.bounds.min[1]),
    Math.abs(part.bounds.max[2] - part.bounds.min[2]),
  ]
}

function sameSize(a: [number, number, number], b: [number, number, number], tolerance = 0.08): boolean {
  const maxA = Math.max(...a, 1e-6)
  const maxB = Math.max(...b, 1e-6)
  if (Math.abs(maxA - maxB) / Math.max(maxA, maxB) > tolerance) return false
  return a.every((value, index) => Math.abs(value - b[index]) / Math.max(maxA, maxB) <= tolerance * 1.6)
}

function normalized(value: number, min: number, max: number): number {
  const span = max - min
  return span > 1e-6 ? (value - min) / span : 0.5
}

interface RuleContext {
  part: ModelPartInput
  size: [number, number, number]
  assemblyBounds: BoundsInput
  assemblyCenter: [number, number, number]
  nearIdenticalCount: number
  mirrorPartner: string | null
  maxVolume: number
  depth: number
  partCount: number
}

function suggestFor(context: RuleContext): LabelSuggestion | null {
  const { part, size, assemblyBounds, nearIdenticalCount, mirrorPartner, maxVolume } = context
  const maxExtent = Math.max(...size, 1e-6)
  const minExtent = Math.min(...size.filter((value) => value > 1e-6), maxExtent)
  const thinness = minExtent / maxExtent
  const cx = normalized(part.center[0], assemblyBounds.min[0], assemblyBounds.max[0])
  const cy = normalized(part.center[1], assemblyBounds.min[1], assemblyBounds.max[1])
  const cz = normalized(part.center[2], assemblyBounds.min[2], assemblyBounds.max[2])
  const assemblyMax = Math.max(
    assemblyBounds.max[0] - assemblyBounds.min[0],
    assemblyBounds.max[1] - assemblyBounds.min[1],
    assemblyBounds.max[2] - assemblyBounds.min[2],
    1e-6,
  )
  const roundish = maxExtent / Math.max(minExtent, 1e-6) <= 1.45
  const nearCorner = (cx < 0.3 || cx > 0.7) && (cz < 0.3 || cz > 0.7)

  if (nearIdenticalCount >= 2 && roundish && cy <= 0.45) {
    return {
      label: 'Possible wheel',
      confidence: Math.min(0.82, 0.55 + nearIdenticalCount * 0.05 + (nearCorner ? 0.06 : 0)),
      source: 'pattern',
      reasons: [
        `${nearIdenticalCount} near-identical parts have matching bounds and triangle counts`,
        `This part sits in the lower ${Math.round(cy * 100)}% of the model`,
        nearCorner ? 'Its centre is near a bottom corner of the assembly' : 'Its centre is not under the body',
        `Bounding box edges are within ${round(maxExtent / Math.max(minExtent, 1e-6), 2)}:1, consistent with a round shape`,
      ],
    }
  }

  if (thinness <= 0.12 && cy >= 0.5 && maxExtent >= assemblyMax * 0.12) {
    return {
      label: 'Possible window or glass panel',
      confidence: 0.55,
      source: 'geometry',
      reasons: [
        'One bounding-box axis is at most 12% of the other two',
        `Its centre is in the upper ${Math.round((1 - cy) * 100)}% of the model`,
        'It is large enough to span part of the body',
      ],
    }
  }

  if (thinness <= 0.2 && cy >= 0.2 && cy <= 0.72 && (cx < 0.22 || cx > 0.78 || cz < 0.22 || cz > 0.78)) {
    return {
      label: 'Possible door or side panel',
      confidence: 0.48,
      source: 'geometry',
      reasons: [
        'The part is flat: one axis is at most 20% of the longest axis',
        'Its centre is on an outer side of the assembly',
        'Its vertical centre is between 20% and 72% of the model height',
      ],
    }
  }

  if (context.partCount > 1 && context.depth <= 1 && part.bboxVolume >= maxVolume * 0.35) {
    return {
      label: 'Possible body or shell',
      confidence: 0.5,
      source: 'hierarchy',
      reasons: [
        'It is at or near the top of the hierarchy',
        `Its bounding-box volume is ${Math.round((part.bboxVolume / Math.max(maxVolume, 1e-6)) * 100)}% of the largest part`,
      ],
    }
  }

  if (mirrorPartner && part.bboxVolume <= maxVolume * 0.02 && maxExtent >= assemblyMax * 0.05) {
    return {
      label: 'Possible mirror or light',
      confidence: 0.42,
      source: 'pattern',
      reasons: [
        'A similarly sized part exists at a mirrored position',
        'The part is small relative to the assembly',
      ],
    }
  }

  if (part.bboxVolume <= maxVolume * 0.005 && maxExtent / Math.max(minExtent, 1e-6) >= 3) {
    return {
      label: 'Possible handle, trim or fastener',
      confidence: 0.4,
      source: 'geometry',
      reasons: [
        'The part is small: under 0.5% of the largest bounding-box volume',
        'It is elongated, with a longest-to-shortest axis ratio of at least 3:1',
      ],
    }
  }

  return null
}

function duplicateSignature(part: ModelPartInput): string {
  const size = sizeOf(part).map((value) => Math.round(value * 100) / 100)
  return `${size.join('x')}|${Math.round(part.triangles / 10) * 10}`
}

export function analyzeModel(input: {
  hash: string
  fileName: string
  parts: ModelPartInput[]
  bounds: BoundsInput
  center: [number, number, number]
  warnings?: string[]
  now?: number
  analysisMs: number
}): ModelAnalysis {
  const parts = input.parts.slice()
  const byPath = new Map(parts.map((part) => [part.nodePath, part]))
  const maxVolume = parts.reduce((max, part) => Math.max(max, part.bboxVolume), 0)
  const sizeByPath = new Map(parts.map((part) => [part.nodePath, sizeOf(part)]))

  const groups = new Map<string, string[]>()
  for (const part of parts) {
    const signature = duplicateSignature(part)
    const list = groups.get(signature) ?? []
    list.push(part.nodePath)
    groups.set(signature, list)
  }
  const nearIdenticalFor = (part: ModelPartInput): string[] => {
    const size = sizeOf(part)
    return parts
      .filter((other) => other.nodePath !== part.nodePath
        && Math.abs(other.triangles - part.triangles) <= Math.max(8, part.triangles * 0.05)
        && sameSize(size, sizeOf(other)))
      .map((other) => other.nodePath)
  }

  const mirrorFor = (part: ModelPartInput): { nodePath: string; axis: 'x' | 'y' | 'z' } | null => {
    const assemblySpan = [
      input.bounds.max[0] - input.bounds.min[0],
      input.bounds.max[1] - input.bounds.min[1],
      input.bounds.max[2] - input.bounds.min[2],
    ]
    let best: { nodePath: string; axis: 'x' | 'y' | 'z'; score: number } | null = null
    for (const axis of ['x', 'y', 'z'] as const) {
      const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      const tolerance = Math.max(assemblySpan[index] * 0.08, 1e-4)
      for (const other of parts) {
        if (other.nodePath === part.nodePath) continue
        if (!sameSize(sizeOf(part), sizeOf(other), 0.12)) continue
        if (Math.abs(other.triangles - part.triangles) > Math.max(10, part.triangles * 0.1)) continue
        const mirrored = 2 * input.center[index] - part.center[index]
        const gap = Math.abs(other.center[index] - mirrored)
        if (gap > tolerance) continue
        const otherIndices = [0, 1, 2].filter((value) => value !== index)
        const planarGap = otherIndices.reduce((sum, value) => sum + Math.abs(other.center[value] - part.center[value]), 0)
        if (planarGap > Math.max(assemblySpan[otherIndices[0]] * 0.05, 0.01)) continue
        const score = gap + planarGap
        if (!best || score < best.score) best = { nodePath: other.nodePath, axis, score }
      }
    }
    return best ? { nodePath: best.nodePath, axis: best.axis } : null
  }

  const nearestFor = (part: ModelPartInput): Array<{ nodePath: string; distance: number }> => {
    return parts
      .filter((other) => other.nodePath !== part.nodePath)
      .map((other) => ({ nodePath: other.nodePath, distance: round(distance(part.center, other.center)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
  }

  const childrenFor = (part: ModelPartInput): string[] => {
    return parts.filter((other) => other.parentPath === part.nodePath).map((other) => other.nodePath)
  }

  const analysed: ModelPartAnalysis[] = []
  let genericParts = 0
  for (const part of parts) {
    const nameQuality = classifyName(part.name)
    if (nameQuality.quality === 'generic') genericParts += 1
    const nearIdenticalPaths = nearIdenticalFor(part)
    const mirrorPartner = mirrorFor(part)
    const suggestion = suggestFor({
      part,
      size: sizeByPath.get(part.nodePath) ?? sizeOf(part),
      assemblyBounds: input.bounds,
      assemblyCenter: input.center,
      nearIdenticalCount: nearIdenticalPaths.length + 1,
      mirrorPartner: mirrorPartner?.nodePath ?? null,
      maxVolume,
      depth: part.depth,
      partCount: parts.length,
    })
    analysed.push({
      nodePath: part.nodePath,
      parentPath: part.parentPath,
      name: part.name,
      type: part.type,
      depth: part.depth,
      extras: part.extras,
      vertices: part.vertices,
      triangles: part.triangles,
      bounds: part.bounds,
      center: part.center,
      bboxVolume: part.bboxVolume,
      size: sizeByPath.get(part.nodePath) ?? sizeOf(part),
      nameQuality: nameQuality.quality,
      nameReason: nameQuality.reason,
      children: childrenFor(part),
      nearestNeighbours: nearestFor(part),
      mirrorPartner,
      nearIdentical: {
        count: nearIdenticalPaths.length + 1,
        nodePaths: [part.nodePath, ...nearIdenticalPaths],
      },
      suggestion,
    })
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, nodePaths]) => nodePaths.length >= 3)
    .map(([signature, nodePaths]) => ({ signature, count: nodePaths.length, nodePaths }))

  const mirroredPairs: AssemblyAnalysis['mirroredPairs'] = []
  for (const part of analysed) {
    if (!part.mirrorPartner) continue
    if (mirroredPairs.some((pair) => pair.a === part.mirrorPartner?.nodePath && pair.b === part.nodePath)) continue
    const partner = analysed.find((item) => item.nodePath === part.mirrorPartner?.nodePath)
    if (partner) mirroredPairs.push({ a: part.nodePath, b: partner.nodePath, axis: part.mirrorPartner.axis })
  }

  const warnings = [...(input.warnings ?? [])]
  if (input.parts.length > 200) warnings.push(`${input.parts.length} named nodes were found; analysis read them all.`)
  const triangles = parts.reduce((sum, part) => sum + part.triangles, 0)
  const vertices = parts.reduce((sum, part) => sum + part.vertices, 0)

  return {
    version: 1,
    createdAt: input.now ?? Date.now(),
    hash: input.hash,
    fileName: input.fileName,
    parts: analysed,
    assembly: {
      rootParts: parts.filter((part) => !part.parentPath || !byPath.has(part.parentPath)).map((part) => part.nodePath),
      mirroredPairs,
      duplicateGroups,
    },
    totals: { parts: parts.length, vertices, triangles },
    bounds: input.bounds,
    center: input.center,
    genericParts,
    warnings,
    analysisMs: Math.round(input.analysisMs),
  }
}

export function labelStateFor(
  part: ModelPartAnalysis,
  confirmation: string | undefined,
): { state: LabelState; displayName: string; confidence: number | null; reasons: string[] } {
  if (confirmation) {
    return { state: 'confirmed', displayName: confirmation, confidence: null, reasons: ['Confirmed by you on this device.'] }
  }
  if (part.suggestion) {
    return {
      state: 'suggested',
      displayName: part.suggestion.label,
      confidence: part.suggestion.confidence,
      reasons: part.suggestion.reasons,
    }
  }
  return { state: 'unknown', displayName: part.name, confidence: null, reasons: [part.nameReason] }
}
