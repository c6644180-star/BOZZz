export type ShellPanel = 'history' | 'menu' | 'settings' | 'desktop' | 'chat' | null

export type OpenablePanel = Exclude<ShellPanel, null>

/**
 * The shell keeps exactly one slide-over at a time. Opening another panel
 * replaces the current one, so History and Chat can never be open together.
 */
export function togglePanel(current: ShellPanel, target: OpenablePanel): ShellPanel {
  return current === target ? null : target
}

export function isPanelOpen(current: ShellPanel, target: OpenablePanel): boolean {
  return current === target
}
