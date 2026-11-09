// Honest Web Speech API wrapper. Reports real browser capability and never
// fabricates transcripts or audio. If an API is missing, callers must show
// that status rather than simulate one.

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }>
}

interface SpeechRecognitionErrorLike {
  error: string
  message?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as RecognitionCtor | null
}

export function ttsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function asrAvailable(): boolean {
  return recognitionCtor() !== null
}

export interface SpeakHandlers {
  onStart?: () => void
  onEnd?: () => void
  onWord?: (text: string) => void
}

export function speak(text: string, handlers: SpeakHandlers = {}): boolean {
  if (!ttsAvailable() || !text.trim()) return false
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'en-US'
  utter.rate = 1.02
  utter.onstart = () => handlers.onStart?.()
  utter.onend = () => handlers.onEnd?.()
  utter.onerror = () => handlers.onEnd?.()
  utter.onboundary = (event) => {
    if (typeof event.charIndex !== 'number') return
    const word = text.slice(event.charIndex).split(/\s+/)[0]
    if (word) handlers.onWord?.(word)
  }
  window.speechSynthesis.speak(utter)
  return true
}

export function stopSpeaking(): void {
  if (ttsAvailable()) window.speechSynthesis.cancel()
}

export interface ListenHandlers {
  onPartial: (text: string) => void
  onFinal: (text: string, confidence: number | null) => void
  onError: (reason: string) => void
  onEnd: () => void
}

export interface ActiveListener {
  stop: () => void
}

export interface ListenOptions {
  continuous?: boolean
}

export function startListening(handlers: ListenHandlers, options: ListenOptions = {}): ActiveListener | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null
  const recognition = new Ctor()
  recognition.lang = 'en-US'
  recognition.continuous = options.continuous === true
  recognition.interimResults = true
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const transcript = result[0].transcript
      const rawConfidence = result[0].confidence
      const confidence = Number.isFinite(rawConfidence) && rawConfidence > 0 ? Math.min(1, rawConfidence) : null
      if (result.isFinal) handlers.onFinal(transcript.trim(), confidence)
      else handlers.onPartial(transcript.trim())
    }
  }
  recognition.onerror = (event) => handlers.onError(event.error)
  recognition.onend = () => handlers.onEnd()
  try {
    recognition.start()
  } catch {
    return null
  }
  return { stop: () => recognition.stop() }
}
