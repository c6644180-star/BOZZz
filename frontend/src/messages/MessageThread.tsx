import { useState } from 'react'
import { ChevronUp, CircleHelp } from 'lucide-react'
import type { BciMessage } from '../services/bci'
import { formatWhen, reasonLabel } from './format'

const WINDOW_SIZE = 250

export function MessageThread({ messages }: { messages: BciMessage[] }) {
  const [visible, setVisible] = useState(WINDOW_SIZE)
  const shown = messages.length > visible ? messages.slice(-visible) : messages
  const hidden = messages.length - shown.length

  if (!messages.length) {
    return <p className="bci-empty-note">This conversation has no messages.</p>
  }

  return (
    <div className="bci-thread-scroll">
      {hidden > 0 && (
        <button type="button" className="bci-earlier" onClick={() => setVisible((value) => value + WINDOW_SIZE)}>
          <ChevronUp /> Show {hidden} earlier message{hidden === 1 ? '' : 's'}
        </button>
      )}
      <ol className="bci-thread-list" aria-label="Conversation messages">
        {shown.map((message) => (
          <li key={message.id} className={`bci-message is-${message.direction}`}>
            <div className="bci-message-meta">
              <strong>{message.sender}</strong>
              <span>{message.direction === 'outbound' ? 'You' : 'Them'}</span>
              <time dateTime={message.sent_at || undefined}>{formatWhen(message.sent_at)}</time>
            </div>
            <p className="bci-message-text">{message.text}</p>
            {(message.attention.length > 0 || message.unanswered) && (
              <div className="bci-message-tags">
                {message.unanswered && <span className="bci-tag is-warn"><CircleHelp /> Unanswered</span>}
                {message.attention.map((reason) => (
                  <span key={reason} className="bci-tag">{reasonLabel(reason)}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
