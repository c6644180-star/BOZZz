import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandBar } from '../components/chat/CommandBar'
import { HomeCaptions } from '../components/home/HomeCaptions'
import { HomeComposer, type ComposerSeed } from '../components/home/HomeComposer'
import { HomeDock } from '../components/home/HomeDock'
import { DataWidgets } from '../components/hud/DataWidgets'
import { HudNav } from '../components/hud/HudNav'
import { Orb } from '../components/orb/Orb'
import { OrbVoiceStatus } from '../components/orb/OrbVoiceStatus'
import { VoiceWave } from '../components/orb/VoiceWave'
import { GestureToggle } from '../components/orb/GestureToggle'
import { SHORTCUT_DELAY_MS, SHORTCUT_LETTERS, shouldOpenComposerOnKey } from '../home/composer'
import type { ShellPanel } from '../home/panels'
import { useBozzVoice } from '../hooks/useBozzVoice'
import { isMiniModeActive, MINI_MODE_EVENT } from '../services/desktopMode'
import type { ConnStatus } from '../types/bozz'

const SUGGESTIONS = ['Show history', 'Open chat', 'Open system', 'Open settings']

export default function HomePage({ status }: { status: ConnStatus }) {
  const { orbState, caption, settings, voiceNote, messages, mic, toggleListening } = useBozzVoice()
  const visualOrbState = status === 'offline' && orbState === 'idle' ? 'offline' : orbState
  const pinned = settings.alwaysShowChat
  const showBar = pinned || !settings.orbOnly

  const [composerOpen, setComposerOpen] = useState(false)
  const [seed, setSeed] = useState<ComposerSeed>({ text: '', nonce: 0 })
  const [miniActive, setMiniActive] = useState(() => isMiniModeActive())
  // Electron keeps the renderer's visibilityState at "visible" while the main
  // window is hidden, so the orb needs the mode switch as an explicit pause.
  useEffect(() => {
    const onMode = (event: Event) => setMiniActive((event as CustomEvent<boolean>).detail === true)
    window.addEventListener(MINI_MODE_EVENT, onMode)
    return () => window.removeEventListener(MINI_MODE_EVENT, onMode)
  }, [])
  const pending = useRef<{ letter: string; timer: number } | null>(null)
  const panelRef = useRef<ShellPanel>(null)

  const lastUser = [...messages].reverse().find((message) => message.from === 'user')?.text ?? null

  const openComposer = useCallback((text = '') => {
    setComposerOpen(true)
    setSeed((previous) => ({ text, nonce: previous.nonce + 1 }))
  }, [])

  const cancelPending = useCallback(() => {
    if (!pending.current) return null
    window.clearTimeout(pending.current.timer)
    const letter = pending.current.letter
    pending.current = null
    return letter
  }, [])

  useEffect(
    () => () => {
      if (pending.current) window.clearTimeout(pending.current.timer)
    },
    [],
  )

  const handleTypeRequest = useCallback(() => {
    if (orbState === 'listening') toggleListening()
    openComposer()
  }, [openComposer, orbState, toggleListening])

  // Typing on the home screen opens the composer. Single-letter panel shortcuts
  // wait briefly so a word like "chat" is typed instead of toggling a panel.
  useEffect(() => {
    if (showBar) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        cancelPending()
        if (composerOpen) setComposerOpen(false)
        return
      }
      const target = event.target as HTMLElement | null
      const editable =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[contenteditable="true"]') !== null)
      if (
        !shouldOpenComposerOnKey({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          editable,
        })
      ) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      const earlier = cancelPending()
      if (earlier) {
        openComposer(`${earlier}${event.key}`)
        return
      }
      const action = SHORTCUT_LETTERS[event.key.toLowerCase()]
      if (action) {
        pending.current = {
          letter: event.key,
          timer: window.setTimeout(() => {
            pending.current = null
            window.dispatchEvent(
              new Event(
                action === 'history' ? 'bozz:open-history' : action === 'chat' ? 'bozz:toggle-chat' : 'bozz:toggle-nav',
              ),
            )
          }, SHORTCUT_DELAY_MS),
        }
        return
      }
      openComposer(event.key)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [cancelPending, composerOpen, openComposer, showBar])

  useEffect(() => {
    const focusComposer = () => {
      if (!panelRef.current) openComposer()
    }
    const onPanel = (event: Event) => {
      const detail = (event as CustomEvent<ShellPanel>).detail ?? null
      panelRef.current = detail
      if (detail) setComposerOpen(false)
    }
    window.addEventListener('bozz:focus-composer', focusComposer)
    window.addEventListener('bozz:panel', onPanel)
    return () => {
      window.removeEventListener('bozz:focus-composer', focusComposer)
      window.removeEventListener('bozz:panel', onPanel)
    }
  }, [openComposer])

  return (
    <section
      className={`home-page${showBar ? ' is-pinned' : ''}${settings.showWidgets ? ' has-widgets' : ''}`}
      data-orb-size={settings.orbSize}
      aria-label="BOZZ voice home"
    >
      <div className="orb-stage">
        <div className="orb-stack">
          <Orb state={visualOrbState} paused={miniActive} />
          <OrbVoiceStatus state={visualOrbState} />
          <VoiceWave active={orbState === 'speaking'} />
          <HomeCaptions
            state={visualOrbState}
            caption={caption}
            lastUser={lastUser}
            enabled={settings.captions}
            onOpenChat={() => window.dispatchEvent(new Event('bozz:open-chat'))}
          />
          <p className="voice-note" role="status">{voiceNote}</p>
        </div>
        <GestureToggle />
      </div>

      {settings.showWidgets && <DataWidgets />}

      {showBar ? (
        <div className="home-bottom">
          <CommandBar suggestions={SUGGESTIONS} />
          <HudNav />
        </div>
      ) : (
        <>
          <HomeNavPeek />
          <HomeComposer open={composerOpen} seed={seed} onClose={() => setComposerOpen(false)} />
          <HomeDock
            listening={orbState === 'listening'}
            micAvailable={mic.available}
            onMic={toggleListening}
            onType={handleTypeRequest}
          />
        </>
      )}
    </section>
  )
}

/** Navigation dock that peeks from the bottom edge, or toggles with N. */
function HomeNavPeek() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const height = window.innerHeight
      if (event.clientY >= height - 34) setOpen(true)
      else if (event.clientY < height - 120) setOpen(false)
    }
    const onLeave = () => setOpen(false)
    const onToggle = () => setOpen((value) => !value)
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    window.addEventListener('bozz:toggle-nav', onToggle)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('bozz:toggle-nav', onToggle)
    }
  }, [])

  return (
    <div
      className={`home-nav-peek${open ? ' is-visible' : ''}`}
      aria-hidden={!open}
      inert={!open}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('a')) setOpen(false)
      }}
    >
      <HudNav />
    </div>
  )
}
