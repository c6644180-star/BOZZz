// Sidecar records for L3DME. They live in localStorage keyed by the model file
// hash plus node path. The model file itself is never touched.

export interface ModelSidecar {
  version: 1
  hash: string
  fileName: string
  confirmedLabels: Record<string, string>
  hidden: string[]
  notes: Record<string, string>
  updatedAt: number
}

const KEY = 'bozz.l3dme.sidecar.v1'

type SidecarMap = Record<string, ModelSidecar>

function readAll(): SidecarMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as SidecarMap) : {}
  } catch {
    return {}
  }
}

function writeAll(map: SidecarMap): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // best effort; the panel shows what is in memory
  }
}

function emptySidecar(hash: string, fileName: string): ModelSidecar {
  return {
    version: 1,
    hash,
    fileName,
    confirmedLabels: {},
    hidden: [],
    notes: {},
    updatedAt: Date.now(),
  }
}

function sanitize(raw: unknown, hash: string, fileName: string): ModelSidecar {
  const base = emptySidecar(hash, fileName)
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Partial<ModelSidecar>
  const labels: Record<string, string> = {}
  if (input.confirmedLabels && typeof input.confirmedLabels === 'object') {
    for (const [path, value] of Object.entries(input.confirmedLabels)) {
      if (typeof value === 'string' && value.trim()) labels[path] = value.trim()
    }
  }
  const notes: Record<string, string> = {}
  if (input.notes && typeof input.notes === 'object') {
    for (const [path, value] of Object.entries(input.notes)) {
      if (typeof value === 'string' && value.trim()) notes[path] = value
    }
  }
  return {
    ...base,
    confirmedLabels: labels,
    hidden: Array.isArray(input.hidden) ? input.hidden.filter((path): path is string => typeof path === 'string') : [],
    notes,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : Date.now(),
  }
}

export function loadSidecar(hash: string, fileName: string): ModelSidecar {
  return sanitize(readAll()[hash], hash, fileName)
}

export function saveSidecar(sidecar: ModelSidecar): ModelSidecar {
  const clean = sanitize(sidecar, sidecar.hash, sidecar.fileName)
  clean.updatedAt = Date.now()
  const map = readAll()
  map[clean.hash] = clean
  writeAll(map)
  return clean
}

export function confirmLabel(hash: string, fileName: string, nodePath: string, label: string): ModelSidecar {
  const sidecar = loadSidecar(hash, fileName)
  const trimmed = label.trim()
  if (trimmed) sidecar.confirmedLabels[nodePath] = trimmed
  else delete sidecar.confirmedLabels[nodePath]
  return saveSidecar(sidecar)
}

export function setNote(hash: string, fileName: string, nodePath: string, note: string): ModelSidecar {
  const sidecar = loadSidecar(hash, fileName)
  if (note.trim()) sidecar.notes[nodePath] = note
  else delete sidecar.notes[nodePath]
  return saveSidecar(sidecar)
}

export function setHidden(hash: string, fileName: string, nodePath: string, hidden: boolean): ModelSidecar {
  const sidecar = loadSidecar(hash, fileName)
  const set = new Set(sidecar.hidden)
  if (hidden) set.add(nodePath)
  else set.delete(nodePath)
  sidecar.hidden = [...set]
  return saveSidecar(sidecar)
}

export function resetSidecar(hash: string): void {
  const map = readAll()
  delete map[hash]
  writeAll(map)
}

export function exportSidecar(sidecar: ModelSidecar): string {
  return JSON.stringify(sidecar, null, 2)
}

export function importSidecar(raw: string, hash: string, fileName: string): ModelSidecar {
  const parsed = JSON.parse(raw) as unknown
  const clean = sanitize(parsed, hash, fileName)
  // A sidecar imported from another model must not leak labels into this one.
  if (parsed && typeof parsed === 'object' && (parsed as Partial<ModelSidecar>).hash !== hash) {
    return loadSidecar(hash, fileName)
  }
  return saveSidecar(clean)
}
