import { useId, useState, type FormEvent } from 'react'
import { Mic, Send, Square } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { runLocalCommand } from './runLocalCommand'

export function CommandBar({
  placeholder = 'Message BOZZ…',
  suggestions = [],
}: {
  placeholder?: string
  suggestions?: string[]
}) {
  const { submit, toggleListening, stopVoice, orbState, mic } = useBozzVoice()
  const navigate = useNavigate()
  const inputId = useId()
  const [message, setMessage] = useState('')
  const listening = orbState === 'listening'
  const speaking = orbState === 'speaking'

  function runCommand(command: string): boolean {
    return runLocalCommand(command, navigate)
  }

  function send(command: string) {
    if (!command) return
    if (runCommand(command)) return
    submit(command)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const command = message.trim()
    if (!command) return
    setMessage('')
    send(command)
  }

  return (
    <div className="command-stack">
      <form className="command-bar" onSubmit={onSubmit} role="search" aria-label="BOZZ command bar">
        <label className="sr-only" htmlFor={inputId}>{placeholder}</label>
        <input
          id={inputId}
          data-command-input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-keyshortcuts="/"
        />
        {speaking ? (
          <button
            type="button"
            className="command-bar__icon is-stop"
            onClick={stopVoice}
            aria-label="Stop voice playback"
            title="Stop voice playback (Esc)"
          >
            <Square />
          </button>
        ) : (
          <button
            type="button"
            className={`command-bar__icon ${listening ? 'is-active' : ''}`}
            onClick={toggleListening}
            aria-pressed={listening}
            aria-label={mic.available ? (mic.listening ? 'Stop voice input' : 'Start voice input') : 'Voice input is unavailable in this browser'}
            title={mic.available ? (mic.listening ? 'Stop voice input' : 'Start voice input') : 'Voice input is unavailable in this browser'}
            disabled={!mic.available}
          >
            <Mic />
          </button>
        )}
        <button className="command-bar__send" type="submit" aria-label="Send command" disabled={!message.trim()}>
          <Send />
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="command-chips" role="group" aria-label="Suggested commands">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setMessage('')
                send(suggestion)
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
