import { CommandBar } from './CommandBar'
import { ConversationShelf } from './ConversationShelf'
import { Transcript } from './Transcript'

/** Full conversation, shown only when the user asks for it. */
export function ChatPanel() {
  return (
    <div className="chat-panel">
      <ConversationShelf />
      <Transcript />
      <CommandBar placeholder="Message BOZZ…" />
    </div>
  )
}
