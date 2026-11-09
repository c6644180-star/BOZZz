import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ComposerIdleTimer } from '../../home/composer'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { runLocalCommand } from '../chat/runLocalCommand'

export interface ComposerSeed {
  text: string
  nonce: number
}

/**
 * Slim one-line composer that slides up from the bottom of the home screen.
 * It collapses only when it is empty and unfocused; Esc closes it immediately.
 */
export function HomeComposer({
  open,
  seed,
  onClose,
}: {
  open: boolean
  seed: ComposerSeed
  onClose: () => void
}) {
  const { submit } = useBozzVoice()
  const navigate = useNavigate()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ComposerIdleTimer | null>(null)
  const lastSeed = useRef(0)
  const closeRef = useRef(onClose)
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const timer = new ComposerIdleTimer(() => closeRef.current())
    timerRef.current = timer
    return () => {
      timer.dispose()
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    timerRef.current?.sync({ open, focused, hasText: value.trim().length > 0 })
  }, [open, focused, value])

  useEffect(() => {
    if (!open) return
    if (seed.nonce !== lastSeed.current) {
      lastSeed.current = seed.nonce
      setValue((current) => `${current}${seed.text}`)
    }
    inputRef.current?.focus()
  }, [open, seed])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const text = value.trim()
    if (!text) return
    setValue('')
    onClose()
    if (runLocalCommand(text, navigate)) return
    submit(text)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  return (
    <form
      className={`home-composer${open ? ' is-open' : ''}`}
      onSubmit={onSubmit}
      role="search"
      aria-label="Message BOZZ"
      aria-hidden={!open}
      inert={!open}
    >
      <label className="sr-only" htmlFor={inputId}>Message BOZZ</label>
      <input
        id={inputId}
        ref={inputRef}
        data-home-composer
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        placeholder="Message BOZZ…"
        autoComplete="off"
        spellCheck={false}
        tabIndex={open ? 0 : -1}
        aria-keyshortcuts="/"
      />
      <button type="submit" className="home-composer__send" aria-label="Send message" disabled={!value.trim()}>
        <ArrowUp />
      </button>
    </form>
  )
}
