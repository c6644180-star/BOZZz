/**
 * Natural-language app commands: open any BOZZ screen, control gestures, hand a task
 * to the computer agent, and manage memory — by voice or typing.
 *
 * Safety rules baked in here:
 * - Navigation only opens BOZZ's own screens; it never changes files or settings.
 * - Desktop mode (real mouse control) cannot be switched on by voice.
 * - Agent tasks only *propose* a plan; the agent's own approval flow still applies.
 * - "Forget" refuses vague phrases and large matches, so memory is never wiped by accident.
 */

export type AppCommand =
  | { kind: 'wake' }
  | { kind: 'navigate'; path: string; label: string }
  | { kind: 'planned'; label: string }
  | { kind: 'panel'; event: string; label: string }
  | { kind: 'gesture'; action: 'start' | 'stop' }
  | { kind: 'gesture-mode'; mode: 'orb' | 'cursor' }
  | { kind: 'gesture-desktop-refused' }
  | { kind: 'agent'; task: string }
  | { kind: 'memory-remember'; text: string }
  | { kind: 'memory-recall'; query: string | null }
  | { kind: 'memory-forget'; phrase: string }

export interface AppCommandResult {
  reply: string
}

interface PageEntry {
  path: string
  label: string
  names: string[]
  planned?: boolean
}

const PAGES: PageEntry[] = [
  { path: '/', label: 'the command center', names: ['home', 'home screen', 'main screen', 'command center', 'orb', 'orb screen'] },
  { path: '/projects', label: 'Projects', names: ['projects', 'project folders', 'holographic projects', 'hologram workspace', 'holographic workspace'] },
  { path: '/spatial', label: 'the Spatial Desktop', names: ['spatial desktop', 'spatial', 'spatial workspace', 'file cards'] },
  { path: '/3d', label: 'the 3D viewer', names: ['3d viewer', '3d', '3d page', 'model viewer', '3d models', 'l3dme'] },
  { path: '/gesture', label: 'Gesture Lab', names: ['gesture lab', 'gesture studio', 'gesture page', 'gesture settings', 'hand tracking lab'] },
  { path: '/messages', label: 'Messages', names: ['messages', 'message workspace', 'bci', 'conversations'] },
  { path: '/research', label: 'Research', names: ['research', 'research lab'] },
  { path: '/vision', label: 'Vision', names: ['vision'] },
  { path: '/devices', label: 'Devices', names: ['devices'] },
  { path: '/devices-hub', label: 'the Device hub', names: ['device hub', 'devices hub'] },
  { path: '/calls', label: 'Calls', names: ['calls', 'call assistant'] },
  { path: '/memory', label: 'Memory', names: ['memory', 'memories', 'my memory', 'memory page'] },
  { path: '/intent-map', label: 'the Intent Map', names: ['intent map', 'intents', 'task map'] },
  { path: '/notifications', label: 'Notifications', names: ['notifications', 'alerts'] },
  { path: '/system', label: 'System', names: ['system', 'system status', 'system page'] },
  { path: '/modules', label: 'Modules', names: ['modules', 'module registry', 'module list'] },
  { path: '/chat', label: 'Chat', names: ['chat page', 'chat screen', 'full chat'] },
  { path: '', label: 'Voice Studio', names: ['voice studio'], planned: true },
  { path: '', label: 'Spatial Intelligence', names: ['spatial intelligence'], planned: true },
  { path: '', label: '3D Engineering Studio', names: ['3d engineering studio', 'engineering studio'], planned: true },
  { path: '', label: 'Health', names: ['health', 'health monitor'], planned: true },
  { path: '', label: 'Market Analyzer', names: ['market analyzer', 'market analyser'], planned: true },
]

const PANELS: { names: string[]; event: string; label: string }[] = [
  { names: ['tools', 'the tools', 'menu', 'the menu', 'tools menu', 'all tools'], event: 'bozz:open-menu', label: 'the tools menu' },
  { names: ['settings', 'my settings', 'the settings'], event: 'bozz:open-settings', label: 'Settings' },
  { names: ['chat', 'the chat', 'my chat', 'chat panel'], event: 'bozz:open-chat', label: 'Chat' },
  { names: ['desktop control', 'desktop control panel'], event: 'bozz:open-desktop', label: 'Desktop Control' },
  { names: ['agent', 'the agent', 'computer agent', 'the computer agent', 'agent panel'], event: 'bozz:open-agent', label: 'the computer agent' },
  { names: ['shortcuts', 'keyboard shortcuts', 'the shortcuts', 'help'], event: 'bozz:show-shortcuts', label: 'the shortcuts list' },
]

const OPEN_VERB = '(?:open|go to|show|take me to|switch to|launch|bring up|display)'
const FILLER = /^(?:please\s+|can you\s+|could you\s+|would you\s+|bozz[,\s]+)+/i
const VAGUE_FORGET = new Set(['it', 'that', 'this', 'about it', 'about that', 'about this', 'everything', 'all', 'them', 'me'])

function clean(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[.!?,]+$/g, '')
    .replace(FILLER, '')
    .replace(FILLER, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripArticle(value: string): string {
  return value.replace(/^(?:the|my|a|an)\s+/, '').replace(/\s+(?:page|screen|tab|module|panel|section|window)$/, '').trim()
}

export function parseAppCommand(raw: string): AppCommand | null {
  const original = raw.trim()
  const text = clean(original)
  if (!text) return null

  if (/^(?:hey |hi |hello |ok |okay )?bozz$/.test(text)) return { kind: 'wake' }

  // --- computer agent: only an explicit hand-off phrase ---
  const agent =
    /^(?:ask|tell|have|let|use)\s+(?:the\s+)?(?:computer\s+)?agent\s+(?:to\s+)?(.{6,})$/.exec(text) ??
    /^(?:computer\s+)?agent\s*[:,-]\s*(.{6,})$/.exec(text) ??
    /^(?:agent|computer agent)\s+(?:do|run|handle)\s+(.{6,})$/.exec(text)
  if (agent) {
    // Keep the user's original casing for the task text.
    const index = original.toLowerCase().indexOf(agent[1].slice(0, 12))
    const task = (index >= 0 ? original.slice(index) : agent[1]).trim().replace(/[.!?]+$/, '')
    return { kind: 'agent', task }
  }

  // --- memory ---
  const remember = /^remember(?:\s+that)?\s+(.{3,})$/.exec(text)
  if (remember) {
    const index = original.toLowerCase().search(/remember/)
    const rest = original.slice(index + 'remember'.length).replace(/^\s+that\b/i, '').trim().replace(/[.!?]+$/, '')
    return { kind: 'memory-remember', text: rest || remember[1] }
  }
  if (/^(?:what do you (?:remember|know) about me|what have you remembered|what did you remember|(?:show|list|read)(?: me)? my memory|what(?:s| is) in my memory)$/.test(text)) {
    return { kind: 'memory-recall', query: null }
  }
  const recall = /^what do you (?:remember|know) about (.{3,})$/.exec(text)
  if (recall) return { kind: 'memory-recall', query: recall[1].trim() }
  const forget = /^forget(?:\s+that)?(?:\s+about)?\s+(.{2,})$/.exec(text)
  if (forget) return { kind: 'memory-forget', phrase: forget[1].trim() }

  // --- gestures ---
  if (/^(?:turn on|start|enable|activate|switch on)\s+(?:the\s+)?(?:hand tracking|hand gestures?|gestures?|gesture control)$/.test(text)) {
    return { kind: 'gesture', action: 'start' }
  }
  if (/^(?:turn off|stop|disable|deactivate|switch off)\s+(?:the\s+)?(?:hand tracking|hand gestures?|gestures?|gesture control)$/.test(text)) {
    return { kind: 'gesture', action: 'stop' }
  }
  const mode = /^(?:switch to|use|change to|go to|set)\s+(?:the\s+)?(orb|cursor|desktop)\s+mode$/.exec(text)
  if (mode) {
    if (mode[1] === 'desktop') return { kind: 'gesture-desktop-refused' }
    return { kind: 'gesture-mode', mode: mode[1] as 'orb' | 'cursor' }
  }
  if (/^(?:calibrate|tune)\s+(?:the\s+|my\s+)?(?:gestures?|hand|hand tracking)$/.test(text)) {
    return { kind: 'navigate', path: '/gesture', label: 'Gesture Lab' }
  }

  // --- open a screen or panel ---
  const open = new RegExp(`^${OPEN_VERB}\\s+(.+)$`).exec(text)
  if (open) {
    const target = open[1].trim()
    const bare = stripArticle(target)
    const panel = PANELS.find((entry) => entry.names.includes(target) || entry.names.includes(bare))
    // "open chat" is the panel; "open chat page" is the full screen below.
    if (panel && !/(?:page|screen)$/.test(target)) return { kind: 'panel', event: panel.event, label: panel.label }
    const page = PAGES.find((entry) => entry.names.includes(target) || entry.names.includes(bare))
    if (page) {
      return page.planned
        ? { kind: 'planned', label: page.label }
        : { kind: 'navigate', path: page.path, label: page.label }
    }
  }
  return null
}

export interface AppCommandDeps {
  dispatch: (name: string, detail?: unknown) => void
  addMemory: (text: string, source: 'voice') => Promise<unknown>
  listMemory: (query?: string) => Promise<{ text: string }[]>
  forgetMemory: (phrase: string) => Promise<number>
}

function defaultDispatch(name: string, detail?: unknown) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }))
}

async function loadMemoryApi(): Promise<Pick<AppCommandDeps, 'addMemory' | 'listMemory' | 'forgetMemory'>> {
  const api = await import('../services/memoryApi')
  return { addMemory: api.addMemory, listMemory: api.listMemory, forgetMemory: api.forgetMemory }
}

function memoryError(error: unknown): string {
  const status = (error as { status?: number })?.status
  if (status === 403) return 'Memory data is switched off. Open Memory and turn it on first.'
  if (error instanceof Error && error.message) return error.message
  return 'I could not reach memory right now.'
}

export async function runAppCommand(raw: string, deps?: Partial<AppCommandDeps>): Promise<AppCommandResult | null> {
  const command = parseAppCommand(raw)
  if (!command) return null
  const dispatch = deps?.dispatch ?? defaultDispatch

  switch (command.kind) {
    case 'wake':
      return { reply: 'I’m here. What would you like to do?' }
    case 'navigate':
      dispatch('bozz:navigate', command.path)
      return { reply: `Opening ${command.label}.` }
    case 'planned':
      return { reply: `${command.label} isn’t built yet. It’s on the roadmap.` }
    case 'panel':
      dispatch(command.event)
      return { reply: `Opening ${command.label}.` }
    case 'gesture':
      dispatch('bozz:gesture-command', { action: command.action })
      return {
        reply:
          command.action === 'start'
            ? 'Starting gesture control. The camera indicator stays on while it is active.'
            : 'Stopping gesture control and releasing the camera.',
      }
    case 'gesture-mode':
      dispatch('bozz:gesture-command', { action: 'mode', mode: command.mode })
      return { reply: `Switching to ${command.mode} mode.` }
    case 'gesture-desktop-refused':
      return {
        reply: 'For safety, desktop mode can only be switched on by hand in the Desktop Control panel, not by voice.',
      }
    case 'agent':
      dispatch('bozz:open-agent')
      dispatch('bozz:agent-start', { task: command.task })
      return { reply: 'I sent that to the computer agent. Review its plan before anything runs.' }
    case 'memory-remember': {
      try {
        const api = deps?.addMemory ? { addMemory: deps.addMemory } : await loadMemoryApi()
        await api.addMemory(command.text, 'voice')
        return { reply: 'Okay, I’ll remember that.' }
      } catch (error) {
        return { reply: memoryError(error) }
      }
    }
    case 'memory-recall': {
      try {
        const api = deps?.listMemory ? { listMemory: deps.listMemory } : await loadMemoryApi()
        const items = await api.listMemory(command.query ?? undefined)
        if (items.length === 0) return { reply: command.query ? 'I have nothing about that.' : 'I have nothing remembered yet.' }
        const shown = items.slice(0, 5).map((item) => item.text)
        const more = items.length > shown.length ? ` And ${items.length - shown.length} more in Memory.` : ''
        return { reply: `${shown.join('. ')}.${more}` }
      } catch (error) {
        return { reply: memoryError(error) }
      }
    }
    case 'memory-forget': {
      if (command.phrase.length < 4 || VAGUE_FORGET.has(command.phrase)) {
        return { reply: 'Tell me exactly what to forget, or delete it from the Memory page.' }
      }
      try {
        const api = deps?.listMemory && deps?.forgetMemory ? { listMemory: deps.listMemory, forgetMemory: deps.forgetMemory } : await loadMemoryApi()
        const matches = await api.listMemory(command.phrase)
        if (matches.length === 0) return { reply: 'I have nothing matching that.' }
        if (matches.length > 3) {
          return { reply: `That matches ${matches.length} items. Please delete them from the Memory page so nothing goes by mistake.` }
        }
        const deleted = await api.forgetMemory(command.phrase)
        return { reply: deleted === 1 ? 'Forgotten.' : `Forgotten ${deleted} items.` }
      } catch (error) {
        return { reply: memoryError(error) }
      }
    }
  }
}
