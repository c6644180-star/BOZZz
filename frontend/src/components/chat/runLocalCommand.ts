/**
 * UI-only navigation phrases. Everything else is sent to BOZZ unchanged.
 * Return true when the phrase was consumed here.
 */
export function runLocalCommand(command: string, navigate: (path: string) => void): boolean {
  const text = command.toLowerCase()
  const fire = (name: string) => window.dispatchEvent(new Event(name))
  if (/^(open|show)( the| my)? history$/.test(text)) { fire('bozz:open-history'); return true }
  if (/^(close|hide)( the)? history$/.test(text)) { fire('bozz:close-panels'); return true }
  if (/^(open|show)( the)? menu$/.test(text)) { fire('bozz:open-menu'); return true }
  if (/^(open|show)( the)? settings$/.test(text)) { fire('bozz:open-settings'); return true }
  if (/^(open|show)( the)? chat$/.test(text)) { fire('bozz:open-chat'); return true }
  if (/^(go )?home$/.test(text)) { fire('bozz:close-panels'); navigate('/'); return true }
  if (/^(open )?system( status)?$/.test(text)) { fire('bozz:close-panels'); navigate('/system'); return true }
  if (/^(open )?intent map$/.test(text)) { fire('bozz:close-panels'); navigate('/intent-map'); return true }
  return false
}
