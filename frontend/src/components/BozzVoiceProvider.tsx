import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BozzVoiceContext, type BozzVoice, type VoiceClarification } from '../context/BozzVoiceContext'
import { asrAvailable, speak, startListening, stopSpeaking, ttsAvailable, type ActiveListener } from '../services/speech'
import {
  classifyAction,
  clarifyAndDecide,
  clarificationPrompt,
  evaluateConfidence,
  isNo,
  isUndoPhrase,
  isYes,
  makeConfidence,
  parseLabelPhrase,
} from '../adaptive/confidence'
import { loadAdaptiveSettings } from '../adaptive/settings'
import { diagnostics } from '../adaptive/diagnostics'
import { undoStack } from '../adaptive/undo'
import { CpuMonitor } from '../adaptive/cpu'
import { HIGH_LOAD_MESSAGE, resolveVoiceMode } from '../adaptive/voice'
import { WAKE_WORD_NOT_INSTALLED } from '../adaptive/wakeWord'
import { playSpeech, stopSpeech as stopPlayback, unlockAudio } from '../services/voiceAudio'
import { fetchTTSStatus, requestSpeech } from '../services/tts'
import { loadConversation, loadHistory, loadSettings, addHistoryEntry, patchHistoryEntry, saveConversation, saveSettings, uid } from '../services/localStore'
import { fetchAIStatus, requestChat } from '../services/backend'
import { desktopBridge } from '../services/desktopBridge'
import { isMiniModeActive } from '../services/desktopMode'
import { pushToast } from '../services/toast'
import { runModelCommand } from '../l3dme/modelControl'
import { getHoloControl, parseHoloCommand, runHoloCommand } from '../holo/commands'
import { runSpatialCommand } from '../spatial/commands'
import { runBciCommand } from '../messages/commands'
import {
  fetchDesktopAllowlist,
  fetchDesktopApprovals,
  fetchDesktopStatus,
  resolveDesktopApproval,
  runDesktopCommand,
  stopDesktopDictation,
  typeDictatedText,
} from '../hgi/desktop/desktopSocket'
import type { AIProviderStatus, ChatMessage, OrbState, TTSServerStatus, VoiceSettings } from '../types/bozz'

const IdleCaption = 'Always here. Always with you.'

const DESKTOP_PHRASE =
  /\b(scroll|volume|mute|unmute|pause (the )?(video|music|song|media)|play (the )?(video|music|song|media)|resume (the )?(video|music|song|media)|next (track|song)|previous (track|song)|switch window|alt tab|show (my )?desktop|minimi[sz]e|maximi[sz]e|go back|go forward|zoom in|zoom out|screenshot|screen shot|brightness|start dictation|stop dictation|dictation mode|type what i say|emergency stop|stop everything|stop all control|stop desktop control)\b/i

const BLOCKED_PHRASE =
  /\b(shut ?down|restart|log ?off|delete|rename|move (a |the )?file|recycle bin|install|uninstall|password|account|send (a )?(message|email)|pay|transfer money|disable (antivirus|security)|powershell|command prompt|cmd|shell|script)\b/i

const STOP_EVERYTHING = /^(?:bozz\s+)?(?:emergency stop|stop everything|stop all control|stop desktop control)$/i
const WAKE_PREFIX = /^(?:bozz|jarvis)[,\s]+/i
const MINI_MODE_PHRASE = /^(?:mini mode|mini orb|minimi[sz]e|enter mini mode|go mini)$/i
const FULL_MODE_PHRASE = /^(?:maximi[sz]e|full mode|full screen|exit mini(?: mode)?|restore window)$/i
const UNBUILT_MODULE_PHRASE = /^(?:open|start|launch|use|show)\s+(?:the\s+)?(?:bcci|dei|calls? module|device environment)\b/i

const unavailableAI: AIProviderStatus = {
  available: false,
  provider: 'ollama',
  configuredModel: 'checking',
  models: [],
  detail: 'Checking the local AI provider.',
}

export function BozzVoiceProvider({ children }: { children: ReactNode }) {
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [caption, setCaption] = useState(IdleCaption)
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadConversation())
  const [settings, setSettings] = useState<VoiceSettings>(() => loadSettings())
  const [listening, setListening] = useState(false)
  const [micReason, setMicReason] = useState<string | null>(null)
  const [clarification, setClarification] = useState<VoiceClarification | null>(null)
  const [ai, setAI] = useState<AIProviderStatus>(unavailableAI)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const [ttsServer, setTtsServer] = useState<TTSServerStatus>({
    configured: false,
    model: 'ElevenLabs',
    detail: 'Checking the speech service.',
  })
  const listenerRef = useRef<ActiveListener | null>(null)
  const chatAbortRef = useRef<AbortController | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const activeHistory = useRef<string | null>(null)
  const thinkTimer = useRef<number | null>(null)
  const errorTimer = useRef<number | null>(null)
  const dictationRef = useRef(false)
  const pushToTalkRef = useRef(false)
  const allowRef = useRef<{ apps: Array<{ label: string }>; urls: Array<{ label: string }> }>({ apps: [], urls: [] })
  const beginDictationRef = useRef<() => void>(() => {})
  const syncDesktopRef = useRef<() => Promise<void>>(async () => {})
  const clarificationRef = useRef<VoiceClarification | null>(null)
  const submitRef = useRef<(text: string) => void>(() => {})
  const pttReleasedAtRef = useRef<number | null>(null)

  const tts = useMemo(() => ({ available: ttsAvailable(), supported: ttsAvailable() }), [])
  const mic = useMemo(() => ({ available: asrAvailable(), listening, reason: micReason }), [listening, micReason])

  const stopListening = useCallback(() => {
    listenerRef.current?.stop()
    listenerRef.current = null
    setListening(false)
  }, [])

  const finishHistory = useCallback((status: 'done' | 'cancelled' | 'failed') => {
    const id = activeHistory.current
    if (!id) return
    patchHistoryEntry(id, { status, updatedAt: Date.now() })
    activeHistory.current = null
  }, [])

  useEffect(() => () => {
    listenerRef.current?.stop()
    chatAbortRef.current?.abort()
    ttsAbortRef.current?.abort()
    if (activeHistory.current) {
      patchHistoryEntry(activeHistory.current, { status: 'cancelled', updatedAt: Date.now() })
      activeHistory.current = null
    }
    if (thinkTimer.current) window.clearTimeout(thinkTimer.current)
    if (errorTimer.current) window.clearTimeout(errorTimer.current)
    stopPlayback()
    stopSpeaking()
  }, [])

  useEffect(() => {
    loadHistory()
      .filter((entry) => entry.kind === 'chat' && entry.status === 'running')
      .forEach((entry) => patchHistoryEntry(entry.id, { status: 'cancelled', updatedAt: Date.now() }))
  }, [])

  useEffect(() => { saveConversation(messages) }, [messages])

  useEffect(() => {
    let disposed = false
    const check = () => void fetchAIStatus().then((status) => { if (!disposed) setAI(status) })
    check()
    const timer = window.setInterval(check, 30000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    let disposed = false
    void fetchTTSStatus().then((status) => { if (!disposed) setTtsServer(status) })
    return () => { disposed = true }
  }, [])

  const stopVoice = useCallback(() => {
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = null
    stopPlayback()
    stopSpeaking()
    setVoiceNote(null)
    setOrbState((state) => (state === 'speaking' || state === 'thinking' ? 'idle' : state))
    setCaption(IdleCaption)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (orbState !== 'speaking' && !ttsAbortRef.current) return
      event.preventDefault()
      stopVoice()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orbState, stopVoice])

  const showOrbError = useCallback((text: string) => {
    if (errorTimer.current) window.clearTimeout(errorTimer.current)
    setOrbState('error')
    setCaption(text)
    pushToast('error', text, undefined, 7000)
    errorTimer.current = window.setTimeout(() => {
      setOrbState((state) => (state === 'error' ? 'idle' : state))
    }, 3200)
  }, [])

  const say = useCallback((text: string, spoken: boolean) => {
    setMessages((prev) => [...prev, { id: uid(), from: 'bozz', text, createdAt: Date.now(), local: true }])
    setCaption(text)
    if (!spoken || !settings.voiceOutput) {
      setOrbState('idle')
      return
    }

    const controller = new AbortController()
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = controller
    const release = () => {
      if (ttsAbortRef.current === controller) ttsAbortRef.current = null
    }

    const fallback = (reason: string) => {
      if (controller.signal.aborted) return
      release()
      const note = reason.length > 110 ? `${reason.slice(0, 107)}…` : reason
      if (!ttsAvailable()) {
        setOrbState('idle')
        setVoiceNote(`No browser voice available — ${note}`)
        pushToast('error', 'Voice output unavailable', note)
        return
      }
      setVoiceNote(`Browser voice in use — ${note}`)
      pushToast('warning', 'Browser voice in use', note)
      setOrbState('thinking')
      const started = speak(text, {
        onStart: () => {
          setOrbState('speaking')
          setCaption(text)
        },
        onEnd: () => {
          setOrbState((state) => (state === 'speaking' ? 'idle' : state))
          setCaption(IdleCaption)
        },
      })
      if (!started) {
        setOrbState('idle')
        setVoiceNote('Voice output is unavailable in this browser.')
      }
    }

    setOrbState('thinking')
    setCaption('Preparing voice…')
    void requestSpeech(text, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return
        const started = playSpeech(blob, {
          onStart: () => {
            if (controller.signal.aborted) return
            setOrbState('speaking')
            setCaption(text)
            setVoiceNote(null)
            setTtsServer((prev) => ({ ...prev, configured: true, detail: null }))
          },
          onEnd: () => {
            release()
            if (controller.signal.aborted) return
            setOrbState((state) => (state === 'speaking' ? 'idle' : state))
            setCaption(IdleCaption)
          },
          onError: fallback,
        })
        if (!started) fallback('Web Audio is unavailable in this browser.')
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        fallback(error instanceof Error ? error.message : 'The ElevenLabs voice service failed.')
      },
    )
  }, [settings.voiceOutput])

  const refreshDesktopAllowlistCache = useCallback(async () => {
    try {
      const allowlist = await fetchDesktopAllowlist()
      allowRef.current = { apps: allowlist.allowlist.apps, urls: allowlist.allowlist.urls }
    } catch {
      // Backend offline — desktop phrases still attempt the real endpoint and report its answer.
    }
  }, [])

  const syncDesktop = useCallback(async () => {
    try {
      const status = await fetchDesktopStatus()
      dictationRef.current = Boolean(status.dictation?.active)
    } catch {
      // Keep the last known state; nothing is claimed from a failed request.
    }
  }, [])
  useEffect(() => {
    syncDesktopRef.current = syncDesktop
  }, [syncDesktop])

  const endDictation = useCallback(async () => {
    dictationRef.current = false
    stopListening()
    setOrbState('idle')
    setCaption('Dictation stopped. Nothing else was typed.')
    try {
      const result = await stopDesktopDictation()
      pushToast('success', 'Dictation off', result.message, 5000)
    } catch {
      // The local dictation state is off even when the backend cannot be reached.
    }
    window.dispatchEvent(new Event('bozz:desktop-changed'))
  }, [stopListening])

  const typeDictated = useCallback(async (text: string) => {
    try {
      const result = await typeDictatedText(text)
      if (result.dictation && result.dictation.active === false) dictationRef.current = false
      if (result.status === 'rejected' || result.status === 'failed') {
        pushToast('warning', 'Dictation not typed', result.message, 6000)
        setCaption(result.message)
      } else {
        setCaption(`Dictation: typed ${text.length} character${text.length === 1 ? '' : 's'}.`)
      }
      window.dispatchEvent(new Event('bozz:desktop-changed'))
      return result
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Dictation typing failed.'
      pushToast('error', 'Dictation not typed', message, 7000)
      setCaption(message)
      return null
    }
  }, [])

  const beginDictationListening = useCallback(() => {
    if (!dictationRef.current) return
    if (!asrAvailable()) {
      showOrbError('Speech recognition is unavailable, so dictation cannot listen.')
      void endDictation()
      return
    }
    stopVoice()
    listenerRef.current?.stop()
    listenerRef.current = null
    setMicReason(null)
    setOrbState('listening')
    setListening(true)
    setCaption('Dictation mode — speak now. Say “stop dictation” to finish. Never dictate passwords or sensitive data.')
    const active = startListening(
      {
        onPartial: (text) => setCaption(text ? `Dictation: ${text}` : 'Dictation: listening…'),
        onFinal: (text) => {
          const phrase = text.trim()
          if (!phrase) return
          if (/^(?:bozz\s+)?(?:stop|end|finish)\b.*\b(?:dictation|typing)\b|^stop dictation$/i.test(phrase)) {
            void endDictation()
            return
          }
          void typeDictated(phrase)
        },
        onError: (reason) => {
          setMicReason(reason)
          if (dictationRef.current) void endDictation()
          showOrbError(reason === 'not-allowed' ? 'Microphone permission was denied.' : `Dictation listening error: ${reason}`)
        },
        onEnd: () => {
          listenerRef.current = null
          setListening(false)
          setOrbState((state) => (state === 'listening' ? 'idle' : state))
          if (dictationRef.current) {
            // Web Speech ends after silence; dictation mode also stops so nothing keeps listening.
            void endDictation()
          }
        },
      },
      { continuous: true },
    )
    if (!active) {
      setListening(false)
      showOrbError('Could not start the microphone for dictation.')
      void endDictation()
      return
    }
    listenerRef.current = active
  }, [endDictation, showOrbError, stopVoice, typeDictated])
  useEffect(() => {
    beginDictationRef.current = beginDictationListening
  }, [beginDictationListening])

  const isDesktopPhrase = useCallback((phrase: string) => {
    if (DESKTOP_PHRASE.test(phrase) || BLOCKED_PHRASE.test(phrase)) return true
    const launch = /^(?:open|launch|start|run)\s+(.+)$/i.exec(phrase)
    if (!launch) return false
    const target = launch[1].replace(/^the\s+/i, '').replace(/\s+(?:website|site)$/i, '').trim().toLowerCase()
    if (!target) return false
    if (/^https?:\/\//.test(target)) return true
    const allow = allowRef.current
    return (
      allow.apps.some((app) => app.label.toLowerCase() === target) ||
      allow.urls.some((entry) => entry.label.toLowerCase() === target)
    )
  }, [])

  const handleDesktopCommand = useCallback(
    async (phrase: string) => {
      try {
        const result = await runDesktopCommand(phrase, 'voice')
        if (!result.handled) return false
        const message = result.message || result.result?.message || 'Desktop command handled.'
        if (result.status === 'blocked') {
          pushToast('error', 'Action blocked for safety', message, 9000)
          say(message, true)
        } else if (result.status === 'awaiting_approval') {
          pushToast('warning', 'Approval needed', message, 10000)
          window.dispatchEvent(new Event('bozz:open-desktop'))
          say(message, true)
        } else if (result.status === 'needs_clarification') {
          setCaption(message)
          say(message, true)
        } else {
          say(message, true)
        }
        if (result.action_id === 'control.emergency_stop') {
          window.dispatchEvent(new Event('bozz-emergency-stop'))
        }
        if (result.action_id === 'dictation.start' && result.status !== 'rejected' && result.status !== 'failed') {
          dictationRef.current = true
          beginDictationRef.current()
        }
        if (result.action_id === 'dictation.stop') dictationRef.current = false
        window.dispatchEvent(new Event('bozz:desktop-changed'))
        void syncDesktop()
        return true
      } catch {
        // Not handled here: normal routing continues and the Desktop panel shows the real failure.
        return false
      }
    },
    [say, syncDesktop],
  )

  const resolveVoiceApproval = useCallback(
    async (approve: boolean) => {
      try {
        const pending = await fetchDesktopApprovals()
        if (!pending.length) return false
        const latest = pending[pending.length - 1]
        const result = await resolveDesktopApproval(latest.approval_id, approve, 'voice')
        say(result.message, true)
        pushToast(approve ? 'success' : 'warning', approve ? 'Approved' : 'Denied', result.message, 6000)
        if (approve && result.action_id === 'dictation.start' && result.status !== 'rejected' && result.status !== 'failed') {
          dictationRef.current = true
          beginDictationRef.current()
        }
        window.dispatchEvent(new Event('bozz:desktop-changed'))
        void syncDesktop()
        return true
      } catch (caught) {
        pushToast('error', 'Approval failed', caught instanceof Error ? caught.message : 'The approval request failed.', 7000)
        return true
      }
    },
    [say, syncDesktop],
  )

  const submit = useCallback(async (text: string, voiceConfidence?: number | null) => {
    const command = text.trim()
    if (!command) return
    const intent = command
      .toLowerCase()
      .replace(/[.!?]+$/, '')
      .replace(WAKE_PREFIX, '')
      .trim()
    if (!intent) return
    stopListening()
    pushToTalkRef.current = false

    const approveIntent = /^(?:bozz[,\s]+)?(?:approve|approved|allow it|go ahead)$/i.test(intent)
    const denyIntent = /^(?:bozz[,\s]+)?(?:deny|reject|cancel it)$/i.test(intent)
    const speechConfidence = typeof voiceConfidence === 'number' && Number.isFinite(voiceConfidence) ? voiceConfidence : null
    const actionable = isDesktopPhrase(intent) || approveIntent || denyIntent
    if (speechConfidence !== null && actionable) {
      const adaptive = loadAdaptiveSettings()
      const confidence = makeConfidence(speechConfidence, 'speech', [
        `Speech recogniser confidence ${Math.round(speechConfidence * 100)}% for “${intent.slice(0, 60)}”.`,
      ])
      diagnostics.recordVoiceConfidence(confidence.value)
      if (adaptive.voice.logCommandText) diagnostics.logCommand(intent, false)
      const actionClass = classifyAction(intent)
      const decision = evaluateConfidence(confidence, actionClass, adaptive.thresholds)
      if (decision.decision === 'block') {
        diagnostics.recordVoiceUncertain(false)
        pushToast('error', 'Blocked for safety', decision.fallback, 8000)
        say(`I can’t do that by voice. ${decision.fallback}`, true)
        return
      }
      if (decision.decision === 'reject') {
        const clarify = adaptive.voice.confirmLowConfidence
          ? clarifyAndDecide(confidence, actionClass, adaptive.thresholds)
          : null
        if (clarify) {
          const next: VoiceClarification = {
            command: intent,
            prompt: clarificationPrompt(intent),
            confidence: confidence.value,
            actionClass,
          }
          clarificationRef.current = next
          setClarification(next)
          diagnostics.recordVoiceUncertain(false)
          say(clarify.fallback, true)
          return
        }
        diagnostics.recordVoiceUncertain(false)
        pushToast('warning', 'Command skipped', decision.fallback, 7000)
        say(decision.fallback, true)
        return
      }
    }

    if (STOP_EVERYTHING.test(intent) || /^bozz[,\s]+stop$/i.test(intent)) {
      dictationRef.current = false
      stopVoice()
      setOrbState('idle')
      setCaption('Emergency stop — desktop control, camera, gestures and voice are off. Nothing was deleted.')
      pushToast('warning', 'Emergency stop', 'Desktop control, camera, gestures and voice were stopped. Nothing was deleted.', 8000)
      window.dispatchEvent(new Event('bozz-emergency-stop'))
      return
    }

    if (isUndoPhrase(intent) || /^(?:that was wrong|undo that|no undo that)$/i.test(intent)) {
      const label = undoStack.undoLast()
      diagnostics.recordVoiceUncertain(!label)
      say(label ? `Undid ${label}.` : 'There is nothing to undo yet.', true)
      return
    }

    const labelName = parseLabelPhrase(command)
    if (labelName) {
      window.dispatchEvent(new CustomEvent('bozz:label-part', { detail: { name: labelName } }))
      say(`Label suggestion “${labelName}” sent to the model panel. Confirm it there before it is saved.`, true)
      return
    }

    if (dictationRef.current) {
      if (/^(?:bozz[,\s]+)?(?:stop|end|finish)\b.*\b(?:dictation|typing)\b|^stop dictation$/i.test(intent)) {
        await endDictation()
        return
      }
      await typeDictated(command.replace(WAKE_PREFIX, '').trim())
      return
    }

    if (approveIntent || denyIntent) {
      const resolved = await resolveVoiceApproval(approveIntent)
      if (resolved) return
    }

    const bridge = desktopBridge()
    if (MINI_MODE_PHRASE.test(intent)) {
      if (!bridge) {
        stopVoice()
        say('Mini mode needs the desktop app.', true)
        return
      }
      if (isMiniModeActive()) {
        say('Mini orb mode is already on.', true)
        return
      }
      stopVoice()
      say('Mini orb mode on. Say maximize, click the orb, or press Ctrl Alt M to come back.', true)
      bridge.setMode('mini')
      return
    }
    if (FULL_MODE_PHRASE.test(intent) && isMiniModeActive()) {
      stopVoice()
      say('Back to the full window.', true)
      bridge?.setMode('full')
      return
    }
    if (UNBUILT_MODULE_PHRASE.test(intent)) {
      stopVoice()
      say('That module isn’t set up yet.', true)
      return
    }

    if (/^(show|open)( the| my)? history$/.test(intent)) {
      stopVoice()
      setCaption('Opening history.')
      window.dispatchEvent(new Event('bozz:open-history'))
      return
    }
    if (/^(close|hide)( the)? history$/.test(intent)) {
      stopVoice()
      setCaption('Closing history.')
      window.dispatchEvent(new Event('bozz:close-panels'))
      return
    }

    if (isDesktopPhrase(intent)) {
      // "zoom in" and "go back" also drive desktop control. While the hologram
      // workspace is open, they act on the scene instead.
      const scene = getHoloControl() ? parseHoloCommand(command, true) : null
      if (scene && (scene.kind === 'back' || scene.kind === 'reset' || scene.kind === 'zoom')) {
        const holo = await runHoloCommand(command)
        if (holo) {
          stopVoice()
          say(holo.reply, true)
          return
        }
      }
      const handled = await handleDesktopCommand(command.replace(WAKE_PREFIX, '').trim())
      if (handled) return
    }

    unlockAudio()
    stopVoice()
    finishHistory('cancelled')
    chatAbortRef.current?.abort()
    chatAbortRef.current = null

    const modelOutcome = await runModelCommand(command)
    if (modelOutcome) {
      say(modelOutcome.reply, true)
      return
    }

    const holoOutcome = await runHoloCommand(command)
    if (holoOutcome) {
      say(holoOutcome.reply, true)
      return
    }

    setOrbState('thinking')
    const bciOutcome = await runBciCommand(command)
    if (bciOutcome) {
      say(bciOutcome.reply, true)
      return
    }

    const spatialOutcome = await runSpatialCommand(command)
    if (spatialOutcome) {
      say(spatialOutcome.reply, true)
      return
    }

    const controller = new AbortController()
    chatAbortRef.current = controller
    const message = { id: uid(), from: 'user' as const, text: command, createdAt: Date.now(), local: true }
    const history = messages.slice(-12)
    const historyId = uid()
    addHistoryEntry({
      id: historyId,
      title: command.length > 90 ? `${command.slice(0, 87)}…` : command,
      kind: 'chat',
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      href: '/chat',
    })
    activeHistory.current = historyId
    setMessages((prev) => [...prev, message])
    setOrbState('thinking')
    setCaption('Thinking with the local AI provider…')
    void requestChat(command, history, controller.signal).then(
      (reply) => {
        if (chatAbortRef.current !== controller) return
        chatAbortRef.current = null
        finishHistory('done')
        say(reply, true)
      },
      (error: unknown) => {
        if (chatAbortRef.current !== controller) return
        chatAbortRef.current = null
        if (error instanceof DOMException && error.name === 'AbortError') return
        finishHistory('failed')
        void fetchAIStatus().then(setAI)
        showOrbError(error instanceof Error ? error.message : 'The local AI request failed.')
      },
    )
  }, [
    endDictation,
    finishHistory,
    handleDesktopCommand,
    isDesktopPhrase,
    messages,
    resolveVoiceApproval,
    say,
    showOrbError,
    stopListening,
    stopVoice,
    typeDictated,
  ])

  useEffect(() => {
    submitRef.current = (value: string) => {
      void submit(value)
    }
  }, [submit])

  const resolveClarification = useCallback((accept: boolean) => {
    const current = clarificationRef.current
    if (!current) return
    clarificationRef.current = null
    setClarification(null)
    const adaptive = loadAdaptiveSettings()
    diagnostics.recordVoiceUncertain(!accept)
    if (adaptive.voice.logCommandText) diagnostics.logCommand(current.command, !accept)
    if (accept) {
      pushToast('success', 'Command confirmed', `Running “${current.command}”.`, 4000)
      window.setTimeout(() => submitRef.current(current.command), 0)
    } else {
      pushToast('info', 'Command skipped', 'Nothing was executed.', 4000)
      say('Skipped. Nothing was executed.', false)
    }
  }, [say])

  useEffect(() => {
    if (!clarification || !asrAvailable()) return
    let active: ActiveListener | null = null
    const timer = window.setTimeout(() => {
      active = startListening(
        {
          onPartial: () => {},
          onFinal: (text, confidence) => {
            if (confidence !== null) diagnostics.recordVoiceConfidence(confidence)
            if (isYes(text)) resolveClarification(true)
            else if (isNo(text)) resolveClarification(false)
            else setCaption('Say “yes” or “no”, or use the buttons.')
          },
          onError: () => {},
          onEnd: () => {},
        },
        { continuous: false },
      )
    }, 350)
    return () => {
      window.clearTimeout(timer)
      active?.stop()
    }
  }, [clarification, resolveClarification])

  const beginCommandListening = useCallback(
    (options: { continuous?: boolean } = {}) => {
      if (!asrAvailable()) {
        setMicReason('This browser has no supported speech recognition engine.')
        showOrbError('Voice recognition is not available in this browser.')
        return
      }
      const wakeMode = options.continuous === true && resolveVoiceMode(settings) === 'wake-word'
      diagnostics.recordVoiceSession()
      setMicReason(null)
      stopVoice()
      setOrbState('listening')
      setListening(true)
      setCaption(wakeMode ? 'Listening for the wake word “BOZZ”…' : 'Listening…')
      const active = startListening(
        {
          onPartial: (text) => {
            if (!wakeMode || WAKE_PREFIX.test(text)) setCaption(text || 'Listening…')
          },
          onFinal: (text, confidence) => {
            const spoken = text.trim()
            if (!spoken) return
            if (wakeMode && !WAKE_PREFIX.test(spoken)) {
              setCaption('Wake word not heard — still listening for “BOZZ …”.')
              return
            }
            if (confidence !== null) diagnostics.recordVoiceConfidence(confidence)
            const releasedAt = pttReleasedAtRef.current
            if (releasedAt !== null) {
              pttReleasedAtRef.current = null
              const latency = Math.round(performance.now() - releasedAt)
              if (latency >= 0) diagnostics.recordPttLatency(latency)
            }
            pushToTalkRef.current = false
            stopListening()
            submit(spoken.replace(WAKE_PREFIX, '').trim(), confidence)
          },
          onError: (reason) => {
            pushToTalkRef.current = false
            stopListening()
            setMicReason(reason)
            showOrbError(reason === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input error: ${reason}`)
          },
          onEnd: () => {
            listenerRef.current = null
            setListening(false)
            setOrbState((state) => (state === 'listening' ? 'idle' : state))
          },
        },
        { continuous: options.continuous },
      )
      if (!active) {
        setListening(false)
        pushToTalkRef.current = false
        showOrbError('Could not start the microphone.')
        return
      }
      listenerRef.current = active
    },
    [settings, showOrbError, stopListening, stopVoice, submit],
  )

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening()
      setCaption('Listening stopped.')
      return
    }
    const mode = resolveVoiceMode(settings)
    if (mode === 'wake-word') {
      pushToast('warning', 'Wake word engine not installed', WAKE_WORD_NOT_INSTALLED, 8000)
      setCaption(WAKE_WORD_NOT_INSTALLED)
      return
    }
    beginCommandListening({ continuous: false })
  }, [beginCommandListening, listening, settings, stopListening])

  const pushToTalkStart = useCallback(() => {
    if (dictationRef.current || listenerRef.current) return
    pttReleasedAtRef.current = null
    pushToTalkRef.current = true
    beginCommandListening()
  }, [beginCommandListening])

  const pushToTalkEnd = useCallback(() => {
    if (!pushToTalkRef.current) return
    pttReleasedAtRef.current = performance.now()
    window.setTimeout(() => {
      if (!pushToTalkRef.current) return
      pushToTalkRef.current = false
      stopListening()
      setOrbState((state) => (state === 'listening' ? 'idle' : state))
      setCaption('Push-to-talk released.')
    }, 700)
  }, [stopListening])

  useEffect(() => {
    if (!settings.pushToTalk) return
    const matches = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return false
      if (settings.pushToTalkKey === 'Control+Space') return event.ctrlKey
      if (settings.pushToTalkKey === 'Alt+Space') return event.altKey
      return !event.ctrlKey && !event.altKey && !event.metaKey
    }
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return (
        element instanceof HTMLElement &&
        (element.tagName === 'INPUT' ||
          element.tagName === 'TEXTAREA' ||
          element.tagName === 'SELECT' ||
          element.isContentEditable ||
          element.closest('[contenteditable="true"]') !== null)
      )
    }
    const onDown = (event: KeyboardEvent) => {
      if (!matches(event) || event.repeat || isTyping(event.target)) return
      event.preventDefault()
      pushToTalkStart()
    }
    const onUp = (event: KeyboardEvent) => {
      if (!matches(event)) return
      pushToTalkEnd()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [pushToTalkEnd, pushToTalkStart, settings.pushToTalk, settings.pushToTalkKey])

  useEffect(() => {
    const onChange = () => {
      void refreshDesktopAllowlistCache()
      void syncDesktopRef.current().then(() => {
        if (dictationRef.current && !listenerRef.current) beginDictationRef.current()
      })
    }
    void refreshDesktopAllowlistCache()
    void syncDesktop()
    window.addEventListener('bozz:desktop-changed', onChange)
    return () => window.removeEventListener('bozz:desktop-changed', onChange)
  }, [refreshDesktopAllowlistCache, syncDesktop])

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (settings.voiceMode !== 'wake-word') return
    pushToast('warning', 'Wake word engine not installed', WAKE_WORD_NOT_INSTALLED, 10000)
    setCaption(WAKE_WORD_NOT_INSTALLED)
    updateSettings({ voiceMode: 'push-to-talk', wakeWord: false })
  }, [settings.voiceMode, updateSettings])

  useEffect(() => {
    if (settings.voiceMode !== 'wake-word') return
    const monitor = new CpuMonitor()
    const adaptive = loadAdaptiveSettings()
    let suspended = false
    const off = monitor.subscribe((reading) => {
      diagnostics.recordCpu({ load: reading.load, ramMb: reading.ramMb })
      if (suspended) return
      if (monitor.sustainedAbove(adaptive.voice.cpuSuspendPercent, adaptive.voice.cpuSuspendSeconds)) {
        suspended = true
        pushToast('warning', 'Wake word suspended', `${HIGH_LOAD_MESSAGE} Re-enable it in Settings when the machine is calmer.`, 10000)
        setCaption(HIGH_LOAD_MESSAGE)
        updateSettings({ voiceMode: 'push-to-talk', wakeWord: false })
      }
    })
    monitor.start()
    return () => {
      off()
      monitor.stop()
    }
  }, [settings.voiceMode, updateSettings])

  const pauseInteraction = useCallback((nextCaption = 'BOZZ interaction paused.') => {
    dictationRef.current = false
    pushToTalkRef.current = false
    stopVoice()
    stopListening()
    finishHistory('cancelled')
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    if (thinkTimer.current) window.clearTimeout(thinkTimer.current)
    thinkTimer.current = null
    setOrbState('idle')
    setCaption(nextCaption)
  }, [stopVoice, stopListening, finishHistory])

  const resetConversation = useCallback(() => {
    stopVoice()
    stopListening()
    finishHistory('cancelled')
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setMessages([])
    setOrbState('idle')
    setCaption(IdleCaption)
  }, [stopVoice, stopListening, finishHistory])

  const value = useMemo<BozzVoice>(() => ({
    orbState, caption, messages, settings, tts, ttsServer, voiceNote, mic, ai, clarification,
    setCaption, submit, stopVoice, toggleListening, pauseInteraction, updateSettings, resetConversation,
    pushToTalkStart, pushToTalkEnd, resolveClarification,
  }), [orbState, caption, messages, settings, tts, ttsServer, voiceNote, mic, ai, clarification, submit, stopVoice, toggleListening, pauseInteraction, updateSettings, resetConversation, pushToTalkStart, pushToTalkEnd, resolveClarification])

  return <BozzVoiceContext.Provider value={value}>{children}</BozzVoiceContext.Provider>
}
