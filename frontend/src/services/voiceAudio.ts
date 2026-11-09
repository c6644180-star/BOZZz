// Real audio playback + frequency analysis. No fabricated bar heights:
// every value comes from AnalyserNode.getByteFrequencyData.

export interface VoicePlayHandlers {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

export type WaveListener = (bins: Uint8Array, level: number) => void

type AudioContextCtor = new () => AudioContext

let context: AudioContext | null = null
let analyser: AnalyserNode | null = null
let source: MediaElementAudioSourceNode | null = null
let element: HTMLAudioElement | null = null
let objectUrl: string | null = null
let bins: Uint8Array<ArrayBuffer> | null = null
let frame = 0
let playing = false
let lastLevelWrite = 0
const listeners = new Set<WaveListener>()

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

function setLevel(level: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--voice-level', level.toFixed(3))
}

function emitFlat() {
  const empty = new Uint8Array(0)
  for (const listener of listeners) listener(empty, 0)
  setLevel(0)
}

/** Call synchronously inside a click/submit handler to unlock Web Audio. */
export function unlockAudio(): boolean {
  if (context) {
    if (context.state === 'suspended') void context.resume()
    return true
  }
  const Ctor = audioContextCtor()
  if (!Ctor) return false
  try {
    context = new Ctor()
  } catch {
    return false
  }
  if (context.state === 'suspended') void context.resume()
  return true
}

export function isSpeechPlaying(): boolean {
  return playing
}

export function subscribeToWave(listener: WaveListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function tick() {
  frame = 0
  if (!playing || !analyser || !bins || document.hidden) return
  analyser.getByteFrequencyData(bins)
  let sum = 0
  for (let index = 0; index < bins.length; index += 1) sum += bins[index]
  const level = Math.min(1, sum / bins.length / 150)
  for (const listener of listeners) listener(bins, level)
  const now = performance.now()
  if (now - lastLevelWrite > 50) {
    lastLevelWrite = now
    setLevel(level)
  }
  frame = requestAnimationFrame(tick)
}

function startLoop() {
  if (frame) return
  lastLevelWrite = 0
  frame = requestAnimationFrame(tick)
}

function onVisibility() {
  if (document.hidden) {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  } else if (playing) {
    startLoop()
  }
}

export function playSpeech(blob: Blob, handlers: VoicePlayHandlers = {}): boolean {
  stopSpeech()
  if (!context) {
    handlers.onError?.('Voice audio needs a user gesture before it can play.')
    return false
  }
  if (context.state === 'suspended') void context.resume()

  const audio = new Audio()
  objectUrl = URL.createObjectURL(blob)
  audio.src = objectUrl
  audio.preload = 'auto'
  element = audio

  source = context.createMediaElementSource(audio)
  analyser = context.createAnalyser()
  analyser.fftSize = 128
  analyser.smoothingTimeConstant = 0.72
  bins = new Uint8Array(analyser.frequencyBinCount)
  source.connect(analyser)
  analyser.connect(context.destination)

  audio.addEventListener('playing', () => {
    if (element !== audio) return
    playing = true
    document.addEventListener('visibilitychange', onVisibility)
    startLoop()
    handlers.onStart?.()
  })
  audio.addEventListener('ended', () => {
    if (element !== audio) return
    handlers.onEnd?.()
    stopSpeech()
  })
  audio.addEventListener('error', () => {
    if (element !== audio) return
    handlers.onError?.('The speech audio could not be played.')
    stopSpeech()
  })

  void audio.play().catch((error: unknown) => {
    if (element !== audio) return
    const blocked = error instanceof DOMException && error.name === 'NotAllowedError'
    handlers.onError?.(
      blocked
        ? 'Autoplay was blocked by the browser.'
        : 'The speech audio could not be played.',
    )
    stopSpeech()
  })
  return true
}

export function stopSpeech(): void {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  playing = false
  document.removeEventListener('visibilitychange', onVisibility)

  const audio = element
  element = null
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (source) {
    try { source.disconnect() } catch { /* already disconnected */ }
    source = null
  }
  if (analyser) {
    try { analyser.disconnect() } catch { /* already disconnected */ }
    analyser = null
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  bins = null
  emitFlat()
}
