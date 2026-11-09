import { useEffect, useRef } from 'react'
import { useBozzVoice } from '../../hooks/useBozzVoice'

export function Transcript() {
  const { messages } = useBozzVoice()
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length])

  if (messages.length === 0) {
    return <div className="transcript empty"><p>No conversation yet. When the local model is available, replies stay on this device.</p></div>
  }
  return (
    <div className="transcript" role="log" aria-live="polite">
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.from}`}>
          <strong>{m.from === 'user' ? 'You' : 'BOZZ · local'}</strong>
          <p>{m.text}</p>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
