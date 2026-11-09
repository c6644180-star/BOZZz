import { useState, type FormEvent } from 'react'
import { Mic, Paperclip, Send } from 'lucide-react'
import { EagleMark } from '../orb/eagle'
import { useBozzVoice } from '../../hooks/useBozzVoice'

export function AskBar({ placeholder = 'Ask BOZZ anything...', className = '' }: { placeholder?: string; className?: string }) {
  const { submit, toggleListening, orbState, mic } = useBozzVoice()
  const [message, setMessage] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    submit(message)
    setMessage('')
  }

  return (
    <form className={`ask-bar ${className}`} onSubmit={onSubmit}>
      <span className="ask-eagle"><EagleMark /></span>
      <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button type="button" className="plain-button" aria-label="Attachment unavailable — no file service connected" onClick={() => setMessage((m) => m)} title="File attachments need a connected service">
        <Paperclip />
      </button>
      <button type="button" className={`plain-button ${orbState === 'listening' ? 'active-mic' : ''}`} onClick={toggleListening}
        aria-label={mic.available ? (mic.listening ? 'Stop voice input' : 'Start voice input') : 'Voice input unavailable in this browser'}>
        <Mic />
      </button>
      <button className="send-orb" aria-label="Send command"><Send /></button>
    </form>
  )
}
