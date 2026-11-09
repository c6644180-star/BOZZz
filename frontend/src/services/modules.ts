import { loadPermissionMirror, savePermissionMirror } from './localStore'
import type {
  ModuleError,
  ModuleInfo,
  ModulePermission,
  ModuleStatus,
  ModulesSnapshot,
  PermissionCatalogItem,
  PermissionId,
  Risk,
} from '../types/modules'

const MODULE_CHANGE_EVENT = 'bozz:modules-changed'

const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  {
    id: 'file_access',
    label: 'File access folder',
    description: 'Read files only inside folders you explicitly allow, plus the sandboxed BOZZ workspace.',
    scope: 'Folders you allow in Settings → File access',
    risk: 'high',
  },
  {
    id: 'message_data',
    label: 'Message data',
    description: 'Let BCI read conversations stored in the local BOZZ database. Nothing is sent or uploaded.',
    scope: 'Local SQLite database only',
    risk: 'high',
  },
  {
    id: 'camera',
    label: 'Camera',
    description: 'Use the camera for local gesture landmarks. Frames are never recorded or uploaded.',
    scope: 'Browser camera, only while Gesture Lab is running',
    risk: 'medium',
  },
  {
    id: 'microphone',
    label: 'Microphone',
    description: 'Capture speech for voice commands and the live audio meter.',
    scope: 'Browser microphone, only while listening',
    risk: 'medium',
  },
  {
    id: 'device_control',
    label: 'Device control',
    description: 'Move the local mouse or control a connected device.',
    scope: 'Local desktop and future device adapters',
    risk: 'high',
  },
  {
    id: 'messaging',
    label: 'Messaging',
    description: 'Create or send messages on your behalf. Nothing is sent in this build.',
    scope: 'Future BCI/BCCI integrations',
    risk: 'high',
  },
  {
    id: 'network',
    label: 'Network',
    description: 'Contact a remote service. BOZZ core chat stays on the configured local endpoint.',
    scope: 'Remote endpoints only when a module is connected',
    risk: 'medium',
  },
]

const catalog = new Map(PERMISSION_CATALOG.map((item) => [item.id, item]))

function permission(id: PermissionId, granted = false): ModulePermission {
  const item = catalog.get(id)
  if (!item) throw new Error(`Unknown permission ${id}`)
  return { ...item, granted, enforced: id === 'file_access' || id === 'message_data' }
}

function moduleInfo(
  info: Omit<ModuleInfo, 'permissions' | 'errors'> & { permissions: PermissionId[] },
): ModuleInfo {
  return {
    ...info,
    permissions: info.permissions.map((id) => permission(id)),
    errors: [],
  }
}

// Local fallback registry. The backend registry is authoritative whenever the
// backend is reachable; this copy keeps module identities available offline.
export const FRONTEND_MODULES: ModuleInfo[] = [
  moduleInfo({
    id: 'voice',
    name: 'Voice',
    version: '1.0.0',
    status: 'Ready',
    description: 'Spoken commands and replies through the existing command bar and voice service.',
    statusDetail: 'Voice controls are installed. The microphone still requires the browser prompt.',
    route: '/chat',
    capabilities: [
      'Browser speech recognition with live captions',
      'Server-side ElevenLabs speech with browser fallback',
      'Real analyser waveform and stop/pause controls',
    ],
    permissions: ['microphone', 'network'],
  }),
  moduleInfo({
    id: 'intent-map',
    name: 'Intent Map',
    version: '1.1.0',
    status: 'Ready',
    description: 'Approval-bound workspace tasks with real verification evidence.',
    statusDetail: 'The backend enforces file access on planning, workspace reads and execution.',
    route: '/intent-map',
    capabilities: [
      'UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT',
      'Server-side workspace permission check',
      'Filesystem evidence is required before a task can be reported done',
      'Append-only audit trail and recoverable file changes',
    ],
    permissions: ['file_access'],
  }),
  moduleInfo({
    id: 'hgi',
    name: 'HGI',
    version: '2.0.0',
    status: 'Ready',
    description: 'Hand Gesture Intelligence plus approval-gated Desktop Control v2.',
    statusDetail: 'The engine is installed; the camera stays released until you start Gesture Lab, and desktop control stays off until you grant device control and turn it on.',
    route: '/gesture',
    capabilities: [
      'One local MediaPipe camera pipeline',
      'Calibration, gesture classifier and typed event bus',
      'Orb, cursor and opt-in desktop-control modes',
      'Tiered desktop actions enforced by the backend with an audit log',
      'Voice, push-to-talk, wake word and approval-gated dictation',
    ],
    permissions: ['camera', 'device_control'],
  }),
  moduleInfo({
    id: 'spatial-desktop',
    name: 'Spatial Desktop',
    version: '1.0.0',
    status: 'Ready',
    description: 'Read-only spatial workspace. Real files become movable cards; nothing is written or deleted.',
    statusDetail: 'The backend reads only folders you allow. There are no delete, move, rename, write or upload endpoints.',
    route: '/spatial',
    capabilities: [
      'Allowed-folder listing, search and previews',
      'Move, resize, select, group, dismiss and restore cards',
      'Named layouts saved as JSON only; dismissing a card never touches the file',
      'OS open only after Intent Map approval, with executables and scripts blocked',
    ],
    permissions: ['file_access'],
  }),
  moduleInfo({
    id: 'holo-projects',
    name: 'Holographic Projects',
    version: '1.0.0',
    status: 'Ready',
    description: 'A 3D folder workspace on the Projects page. It is a scene drawn on the monitor, not a real hologram, and it never writes, moves, renames or deletes a file.',
    statusDetail: 'The workspace is installed and read-only. File access is off by default; the backend rejects any path outside an allowed folder and exposes no file write endpoint.',
    route: '/projects',
    capabilities: [
      '3D folder tree on the monitor from folders you explicitly allow',
      'Read-only model and sidecar byte reads for .glb and .gltf',
      'Hologram exploded view driven by the shared typed model control API',
      'Gesture input only through the existing HGI gesture event bus',
      'Named hologram views saved as JSON with the existing layouts API',
    ],
    permissions: ['file_access'],
  }),
  moduleInfo({
    id: 'l3dme',
    name: 'L3DME',
    version: '1.0.0',
    status: 'Ready',
    description: 'Local 3D model viewer. Files stay in the browser and are never uploaded.',
    statusDetail: 'The viewer is frontend-only; no model bytes reach the backend.',
    route: '/3d',
    capabilities: [
      'Local GLB and glTF file loading with a user file picker',
      'Orbit, zoom, pan, solid, wireframe and transparent modes',
      'Part selection, exploded view and a typed control API',
    ],
    permissions: [],
  }),
  moduleInfo({
    id: 'bci',
    name: 'BCI',
    version: '1.0.0',
    status: 'Ready',
    description: 'Communication intelligence workspace. It drafts and summarises locally; it never sends.',
    statusDetail: 'The local workspace is installed. No messaging transport, account or send endpoint exists. Message data is off by default.',
    route: '/messages',
    capabilities: [
      'Local conversation storage with retention controls',
      'Import plain text, JSON and user-exported WhatsApp chat files',
      'Summaries, unanswered questions, attention markers, drafts and translation',
      'Draft-only output with [CONFIRM] placeholders; no send path exists',
    ],
    permissions: ['message_data'],
  }),
  moduleInfo({
    id: 'bcci',
    name: 'BCCI',
    version: '0.1.0',
    status: 'Not connected',
    description: 'Future call control. The /calls page can only simulate a local notification.',
    statusDetail: 'No telephony or call transport is connected.',
    route: '/calls',
    capabilities: ['Clearly labelled call-notification simulation', 'Real calls (not connected)'],
    permissions: ['microphone', 'messaging', 'network'],
  }),
  moduleInfo({
    id: 'dei',
    name: 'DEI',
    version: '0.0.0',
    status: 'Not connected',
    description: 'Future device environment integration. No devices are controlled here.',
    statusDetail: 'No device adapter is connected. The existing /devices page is unchanged.',
    route: '/devices-hub',
    capabilities: ['Device registry and controls (planned)'],
    permissions: ['device_control', 'network'],
  }),
  moduleInfo({
    id: 'memory',
    name: 'Memory',
    version: '1.0.0',
    status: 'Ready',
    description: 'Browser-local notes and recall surface.',
    statusDetail: 'Notes are stored only in this browser profile.',
    route: '/memory',
    capabilities: ['Local notes stored in browser localStorage', 'No server or cloud sync'],
    permissions: [],
  }),
]

function normalizeStatus(value: unknown): ModuleStatus {
  return value === 'Ready' || value === 'Simulation' || value === 'Error' || value === 'Not connected'
    ? value
    : 'Error'
}

function normalizePermission(value: unknown): ModulePermission | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = String(raw.id ?? '') as PermissionId
  if (!catalog.has(id)) return null
  const base = catalog.get(id)!
  return {
    ...base,
    granted: raw.granted === true,
    enforced: raw.enforced === true,
    risk: (raw.risk === 'low' || raw.risk === 'medium' || raw.risk === 'high'
      ? raw.risk
      : base.risk) as Risk,
  }
}

function normalizeModule(value: unknown): ModuleInfo | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = String(raw.id ?? '').trim()
  if (!id) return null
  return {
    id,
    name: String(raw.name ?? id),
    version: String(raw.version ?? '0.0.0'),
    status: normalizeStatus(raw.status),
    description: String(raw.description ?? ''),
    statusDetail: String(raw.status_detail ?? raw.statusDetail ?? ''),
    route: typeof raw.route === 'string' ? raw.route : null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions.map(normalizePermission).filter((item): item is ModulePermission => item !== null)
      : [],
    errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  }
}

function normalizeError(value: unknown): ModuleError | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  return {
    module: String(raw.module ?? 'unknown'),
    title: String(raw.title ?? 'Error'),
    detail: String(raw.detail ?? ''),
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
    outcome: String(raw.outcome ?? 'error'),
  }
}

function normalizeSnapshot(value: unknown): ModulesSnapshot {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    registryVersion: String(raw.registry_version ?? '1.0.0'),
    modules: Array.isArray(raw.modules)
      ? raw.modules.map(normalizeModule).filter((item): item is ModuleInfo => item !== null)
      : [],
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions
          .map((item): PermissionCatalogItem | null => {
            if (!item || typeof item !== 'object') return null
            const entry = item as Record<string, unknown>
            const id = String(entry.id ?? '') as PermissionId
            const base = catalog.get(id)
            if (!base) return null
            return {
              ...base,
              risk: (entry.risk === 'low' || entry.risk === 'medium' || entry.risk === 'high'
                ? entry.risk
                : base.risk) as Risk,
            }
          })
          .filter((item): item is PermissionCatalogItem => item !== null)
      : PERMISSION_CATALOG,
    errors: Array.isArray(raw.errors)
      ? raw.errors.map(normalizeError).filter((item): item is ModuleError => item !== null)
      : [],
  }
}

function mirrorFrom(snapshot: ModulesSnapshot) {
  return Object.fromEntries(
    snapshot.modules.map((module) => [
      module.id,
      Object.fromEntries(module.permissions.map((item) => [item.id, item.granted])),
    ]),
  )
}

export function frontendSnapshot(): ModulesSnapshot {
  const mirror = loadPermissionMirror()
  return {
    registryVersion: '1.0.0',
    permissions: PERMISSION_CATALOG,
    modules: FRONTEND_MODULES.map((module) => ({
      ...module,
      permissions: module.permissions.map((item) => ({
        ...item,
        granted: mirror[module.id]?.[item.id] === true,
      })),
    })),
    errors: [],
  }
}

export function notifyModulesChanged(): void {
  window.dispatchEvent(new Event(MODULE_CHANGE_EVENT))
}

export function onModulesChanged(handler: () => void): () => void {
  window.addEventListener(MODULE_CHANGE_EVENT, handler)
  return () => window.removeEventListener(MODULE_CHANGE_EVENT, handler)
}

export async function fetchModules(signal?: AbortSignal): Promise<ModulesSnapshot> {
  const response = await fetch('/api/modules', {
    signal: signal ?? AbortSignal.timeout(6_000),
  })
  if (!response.ok) throw new Error(`The module registry request failed (${response.status}).`)
  const snapshot = normalizeSnapshot(await response.json())
  savePermissionMirror(mirrorFrom(snapshot))
  return snapshot
}

export async function changeModulePermission(
  moduleId: string,
  permissionId: PermissionId,
  granted: boolean,
): Promise<ModuleInfo> {
  const response = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/permissions`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission: permissionId, granted }),
  })
  const body = await response.json().catch(() => ({})) as { detail?: string } & Record<string, unknown>
  if (!response.ok) throw new Error(body.detail || `The permission change failed (${response.status}).`)
  const module = normalizeModule(body)
  if (!module) throw new Error('The backend returned an invalid module record.')
  const mirror = loadPermissionMirror()
  mirror[moduleId] = Object.fromEntries(module.permissions.map((item) => [item.id, item.granted]))
  savePermissionMirror(mirror)
  notifyModulesChanged()
  return module
}

export function requiredPermissionLabels(module: ModuleInfo): string {
  return module.permissions.map((item) => item.label).join(', ')
}

export function statusSlug(status: ModuleStatus): string {
  return status.toLowerCase().replace(/\s+/g, '-')
}
