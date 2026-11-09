import { CommandBar } from './CommandBar'
import { Transcript } from './Transcript'

/** Full conversation, shown only when the user asks for it. */
export function ChatPanel() {
  return (
    <div className="chat-panel">
      <Transcript />
      <CommandBar placeholder="Message BOZZ…" />
    </div>
  )
}
