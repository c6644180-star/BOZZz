export type DesktopConnection = 'disconnected' | 'connecting' | 'connected' | 'stopped' | 'error'

export type DesktopStateChip = 'Off' | 'Armed' | 'Active' | 'Paused' | 'Emergency stopped'

export interface DesktopScreen {
  width: number
  height: number
}

export interface DesktopCapabilities {
  mouse: boolean
  keyboard: boolean
  volume: boolean
  media: boolean
  brightness: boolean
  window: boolean
  screenshot: boolean
  app_launch: boolean
}

export interface PendingApproval {
  approval_id: string
  action_id: string
  label: string
  tier: number
  source: string
  target: string | null
  expires_in_ms: number
}

export interface DesktopActionRecord {
  action_id: string
  label: string
  tier: number | null
  status: 'verified' | 'executed' | 'rejected' | 'blocked' | 'failed'
  verified: boolean
  source: string
  detail: string
  at?: string
}

export interface DictationState {
  active: boolean
  remaining_chars: number
  max_chars: number
  max_chars_per_utterance: number
}

export interface DesktopBridgeState {
  connected: boolean
  connections: number
}

export interface DesktopStatus {
  version?: number
  state?: DesktopStateChip
  available: boolean
  enabled: boolean
  emergency_stopped: boolean
  token: string
  pyautogui: boolean
  pynput: boolean
  hotkey?: boolean
  screen: DesktopScreen | null
  min_confidence: number
  rate_limit: number
  area?: number
  position?: { x: number; y: number }
  edge_margin?: number
  click_delay_ms?: number
  idle_seconds?: number
  detail: string | null
  disable_reason?: string | null
  bridge?: DesktopBridgeState
  mic_on?: boolean
  paused?: boolean
  capabilities?: DesktopCapabilities
  dictation?: DictationState
  pending_approvals?: PendingApproval[]
  recent_actions?: DesktopActionRecord[]
  last_action?: DesktopActionRecord | null
  allowlist?: { apps: number; urls: number; shortcuts: number }
  approval_ttl_ms?: number
}

export interface DesktopActionParam {
  type: 'number' | 'string'
  required: boolean
  min: number | null
  max: number | null
  max_length: number | null
}

export interface DesktopActionSpec {
  id: string
  tier: number
  label: string
  risk: string
  verify: string
  execute: boolean
  params: Record<string, DesktopActionParam>
}

export interface DesktopAppEntry {
  label: string
  path: string
  added_at?: string
}

export interface DesktopUrlEntry {
  label: string
  url: string
  added_at?: string
}

export interface DesktopShortcutEntry {
  id: string
  label: string
  keys: string[]
  enabled: boolean
}

export interface DesktopAllowlist {
  actions: DesktopActionSpec[]
  allowlist: {
    apps: DesktopAppEntry[]
    urls: DesktopUrlEntry[]
    shortcuts: DesktopShortcutEntry[]
  }
  approval_ttl_ms: number
  rate_limit_per_second: number
  blocked_message: string
  tiers: Record<string, string>
  dictation: {
    max_chars_per_utterance: number
    max_total_chars: number
    idle_timeout_sec: number
  }
}

export interface DesktopActionResult {
  accepted?: boolean
  status: string
  ok?: boolean
  verified?: boolean
  action_id?: string
  label?: string
  tier?: number
  detail?: string
  message: string
  target?: string
  approval?: PendingApproval | null
  dictation?: { active: boolean; remaining_chars: number }
  intent?: unknown
}

export interface DesktopCommandResult {
  handled: boolean
  understood: boolean
  status: string
  message: string
  kind?: 'action' | 'clarify' | 'blocked'
  action_id?: string | null
  label?: string
  tier?: number | null
  result?: DesktopActionResult | null
  approval?: PendingApproval | null
  intent?: unknown
}

export interface DesktopConfigRequest {
  area?: number
  position_x?: number
  position_y?: number
  edge_margin?: number
  click_delay_ms?: number
  idle_seconds?: number
}

export interface DesktopAuditEntry {
  id?: number
  event: string
  action_type: string | null
  target: string | null
  risk: string | null
  outcome: string
  detail: string
  created_at: string
}

export type DesktopCommand =
  | { type: 'move'; x: number; y: number; confidence: number }
  | { type: 'click'; x: number; y: number; confidence: number }
  | { type: 'double_click'; x: number; y: number; confidence: number }
  | { type: 'drag_start'; x: number; y: number; confidence: number }
  | { type: 'drag_move'; x: number; y: number; confidence: number }
  | { type: 'drag_end'; x: number; y: number; confidence: number }
  | { type: 'scroll'; delta: number; confidence: number }
  | { type: 'configure'; area: number; sensitivity: number; smoothing: number }
  | { type: 'presence'; hidden?: boolean; mic_on?: boolean; paused?: boolean }
  | { type: 'tracking' }
  | { type: 'heartbeat'; hidden?: boolean }
  | { type: 'action'; action_id: string; params?: Record<string, unknown>; source?: string; confidence?: number }

export interface DesktopSocketMessage {
  type: 'state' | 'result'
  state?: DesktopStateChip
  enabled?: boolean
  emergency_stopped?: boolean
  connected?: boolean
  accepted?: number
  rejected?: number
  reason?: string
  pending_approvals?: PendingApproval[]
  dictation?: DictationState
  mic_on?: boolean
  last_action?: DesktopActionRecord | null
}

export interface DesktopSocketState {
  connection: DesktopConnection
  detail: string | null
  emergencyStopped: boolean
  state?: DesktopStateChip
  enabled?: boolean
  pendingApprovals?: PendingApproval[]
  dictation?: DictationState
  micOn?: boolean
  lastAction?: DesktopActionRecord | null
  accepted?: number
  rejected?: number
}

function socketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${protocol}://${window.location.host}/ws/desktop?token=${encodeURIComponent(token)}`
  }
  // Electron or a packaged build may not share the Vite proxy.
  return `ws://127.0.0.1:8000/ws/desktop?token=${encodeURIComponent(token)}`
}

export class DesktopSocket {
  onState: ((state: DesktopSocketState) => void) | null = null
  onResult: ((result: DesktopActionResult) => void) | null = null

  private socket: WebSocket | null = null
  private stopped = false

  get connection(): DesktopConnection {
    if (!this.socket) return this.stopped ? 'stopped' : 'disconnected'
    if (this.socket.readyState === WebSocket.OPEN) return 'connected'
    if (this.socket.readyState === WebSocket.CONNECTING) return 'connecting'
    return this.stopped ? 'stopped' : 'disconnected'
  }

  connect(token: string): Promise<void> {
    this.close()
    this.stopped = false
    return new Promise((resolve, reject) => {
      let settled = false
      const socket = new WebSocket(socketUrl(token))
      this.socket = socket
      this.onState?.({ connection: 'connecting', detail: null, emergencyStopped: false })
      socket.onopen = () => {
        settled = true
        this.onState?.({ connection: 'connected', detail: null, emergencyStopped: false })
        resolve()
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as DesktopSocketMessage & Partial<DesktopActionResult>
          if (message.type === 'result') {
            this.onResult?.(message as DesktopActionResult)
            return
          }
          if (message.type !== 'state') return
          if (message.emergency_stopped) this.stopped = true
          this.onState?.({
            connection: message.emergency_stopped
              ? 'stopped'
              : message.reason
                ? 'error'
                : 'connected',
            detail: message.reason ?? null,
            emergencyStopped: Boolean(message.emergency_stopped),
            state: message.state,
            enabled: message.enabled,
            pendingApprovals: message.pending_approvals,
            dictation: message.dictation,
            micOn: message.mic_on,
            lastAction: message.last_action,
            accepted: message.accepted,
            rejected: message.rejected,
          })
        } catch {
          // ignore malformed server messages
        }
      }
      socket.onerror = () => {
        if (settled) return
        settled = true
        this.onState?.({ connection: 'error', detail: 'The desktop WebSocket could not connect.', emergencyStopped: false })
        reject(new Error('The desktop WebSocket could not connect to the local backend.'))
      }
      socket.onclose = () => {
        this.socket = null
        const connection: DesktopConnection = this.stopped ? 'stopped' : 'disconnected'
        this.onState?.({
          connection,
          detail: this.stopped ? 'Desktop control stopped by the emergency stop.' : 'Desktop WebSocket disconnected.',
          emergencyStopped: this.stopped,
        })
        if (!settled) {
          settled = true
          reject(new Error('The desktop WebSocket closed before it connected.'))
        }
      }
    })
  }

  private sendRaw(payload: DesktopCommand | Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(payload))
    return true
  }

  send(command: DesktopCommand): boolean {
    return this.sendRaw(command)
  }

  sendAction(actionId: string, params: Record<string, unknown> = {}, confidence?: number): boolean {
    return this.sendRaw({
      type: 'action',
      action_id: actionId,
      params,
      source: 'gesture',
      confidence,
    })
  }

  sendPresence(presence: { hidden?: boolean; mic_on?: boolean; paused?: boolean }): boolean {
    return this.sendRaw({ type: 'presence', ...presence })
  }

  sendTracking(): boolean {
    return this.sendRaw({ type: 'tracking' })
  }

  sendHeartbeat(hidden?: boolean): boolean {
    return this.sendRaw({ type: 'heartbeat', hidden })
  }

  markStopped(): void {
    this.stopped = true
  }

  close(): void {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    try {
      socket.close()
    } catch {
      // already closed
    }
  }
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>
}

async function fail(response: Response): Promise<never> {
  const body = await readBody(response)
  const detail = typeof body.detail === 'string' ? body.detail : `The desktop endpoint failed (${response.status}).`
  throw new Error(detail)
}

export async function fetchDesktopStatus(): Promise<DesktopStatus> {
  const response = await fetch('/api/desktop/status', { signal: AbortSignal.timeout(3500) })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopStatus
}

export async function setDesktopEnabled(enabled: boolean): Promise<DesktopStatus> {
  const response = await fetch('/api/desktop/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopStatus
}

export async function emergencyStopDesktop(): Promise<DesktopStatus> {
  const response = await fetch('/api/desktop/stop', { method: 'POST', signal: AbortSignal.timeout(4000) })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopStatus
}

export async function fetchDesktopAllowlist(): Promise<DesktopAllowlist> {
  const response = await fetch('/api/desktop/allowlist', { signal: AbortSignal.timeout(5000) })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopAllowlist
}

export async function addDesktopApp(label: string, path: string): Promise<void> {
  const response = await fetch('/api/desktop/allowlist/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, path, confirm: true }),
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) await fail(response)
}

export async function removeDesktopApp(path: string): Promise<void> {
  const response = await fetch('/api/desktop/allowlist/apps/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, confirm: true }),
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) await fail(response)
}

export async function addDesktopUrl(label: string, url: string): Promise<void> {
  const response = await fetch('/api/desktop/allowlist/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, url, confirm: true }),
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) await fail(response)
}

export async function removeDesktopUrl(url: string): Promise<void> {
  const response = await fetch('/api/desktop/allowlist/urls/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, confirm: true }),
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) await fail(response)
}

export async function setDesktopShortcuts(ids: string[]): Promise<void> {
  const response = await fetch('/api/desktop/allowlist/shortcuts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, confirm: true }),
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) await fail(response)
}

export async function runDesktopCommand(text: string, source = 'voice'): Promise<DesktopCommandResult> {
  const response = await fetch('/api/desktop/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopCommandResult
}

export async function runDesktopAction(
  actionId: string,
  params: Record<string, unknown> = {},
  source = 'ui',
): Promise<DesktopActionResult> {
  const response = await fetch('/api/desktop/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action_id: actionId, params, source }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopActionResult
}

export async function fetchDesktopApprovals(): Promise<PendingApproval[]> {
  const response = await fetch('/api/desktop/approvals', { signal: AbortSignal.timeout(4000) })
  if (!response.ok) await fail(response)
  const body = await readBody(response)
  return Array.isArray(body.approvals) ? (body.approvals as PendingApproval[]) : []
}

export async function resolveDesktopApproval(
  approvalId: string,
  approve: boolean,
  via = 'ui',
): Promise<DesktopActionResult> {
  const response = await fetch(`/api/desktop/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve, via }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopActionResult
}

export async function typeDictatedText(text: string): Promise<DesktopActionResult> {
  const response = await fetch('/api/desktop/dictation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopActionResult
}

export async function stopDesktopDictation(): Promise<DesktopActionResult> {
  const response = await fetch('/api/desktop/dictation/stop', { method: 'POST', signal: AbortSignal.timeout(4000) })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopActionResult
}

export async function updateDesktopConfig(payload: DesktopConfigRequest): Promise<DesktopStatus> {
  const response = await fetch('/api/desktop/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopStatus
}

export async function setDesktopPresence(payload: {
  hidden?: boolean
  mic_on?: boolean
  paused?: boolean
}): Promise<DesktopStatus> {
  const response = await fetch('/api/desktop/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000),
  })
  if (!response.ok) await fail(response)
  return (await readBody(response)) as unknown as DesktopStatus
}

export async function fetchDesktopAudit(limit = 20): Promise<DesktopAuditEntry[]> {
  const response = await fetch(`/api/desktop/audit?limit=${limit}`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) await fail(response)
  const body = await readBody(response)
  return Array.isArray(body.entries) ? (body.entries as DesktopAuditEntry[]) : []
}
