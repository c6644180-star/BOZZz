export type WakeWordRuntimePhase = 'off' | 'starting' | 'listening' | 'detected' | 'error'

export interface WakeWordRuntimeState {
  phase: WakeWordRuntimePhase
  detail: string
  score?: number
}

let state: WakeWordRuntimeState = { phase: 'off', detail: 'Microphone is off.' }
let stream: MediaStream | null = null
let context: AudioContext | null = null
let source: MediaStreamAudioSourceNode | null = null
let processor: ScriptProcessorNode | null = null
let silentGain: GainNode | null = null
let socket: WebSocket | null = null
let frame = new Int16Array(1280)
let frameOffset = 0
let stopping = false
let generation = 0

function publish(next: WakeWordRuntimeState) {
  state = next
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bozz:wake-word-state', { detail: next }))
  }
}

function websocketUrl(): string {
  return 'ws://127.0.0.1:8000/voice/wake-word/stream'
}

function waitForServerReady(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('The local wake-word service did not become ready in time.'))
    }, 60000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('error', onError)
      ws.removeEventListener('close', onClose)
    }
    const onMessage = (event: MessageEvent) => {
      let message: { type?: string; message?: string }
      try { message = JSON.parse(String(event.data)) as typeof message } catch {
        cleanup()
        reject(new Error('The local wake-word service returned an invalid response.'))
        return
      }
      if (message.type === 'ready') {
        cleanup()
        resolve()
      } else if (message.type === 'error') {
        cleanup()
        reject(new Error(message.message ?? 'The local wake-word service rejected the session.'))
      }
    }
    const onError = () => {
      cleanup()
      reject(new Error('Could not connect to the local wake-word service at 127.0.0.1:8000.'))
    }
    const onClose = () => {
      cleanup()
      reject(new Error('The local wake-word service closed before it was ready.'))
    }
    ws.addEventListener('message', onMessage)
    ws.addEventListener('error', onError)
    ws.addEventListener('close', onClose)
  })
}

async function releaseAudio(): Promise<void> {
  if (processor) {
    processor.onaudioprocess = null
    try { processor.disconnect() } catch { /* already disconnected */ }
    processor = null
  }
  if (source) {
    try { source.disconnect() } catch { /* already disconnected */ }
    source = null
  }
  if (silentGain) {
    try { silentGain.disconnect() } catch { /* already disconnected */ }
    silentGain = null
  }
  stream?.getTracks().forEach((track) => {
    track.onended = null
    track.stop()
  })
  stream = null
  if (context && context.state !== 'closed') {
    try { await context.close() } catch { /* already closed */ }
  }
  context = null
  frameOffset = 0
  frame = new Int16Array(1280)
}

async function stopInternal(next: WakeWordRuntimeState, notifyServer = true): Promise<void> {
  generation += 1
  if (stopping) return
  stopping = true
  const ws = socket
  socket = null
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (notifyServer) {
      try { ws.send('stop') } catch { /* connection is already closing */ }
    }
    ws.close(1000, 'User stopped wake-word listener')
  } else if (ws && ws.readyState === WebSocket.CONNECTING) {
    ws.close()
  }
  await releaseAudio()
  try { await window.bozzDesktop?.setWakeWordActivity(false) } catch { /* best-effort tray update */ }
  publish(next)
  stopping = false
}

export function getWakeWordRuntimeState(): WakeWordRuntimeState {
  return state
}

export function stopWakeWordListening(): void {
  void stopInternal({ phase: 'off', detail: 'Microphone is off.' })
}

export async function startWakeWordListening(): Promise<void> {
  if (state.phase === 'starting' || state.phase === 'listening') return
  if (!window.bozzDesktop?.isDesktop) {
    throw new Error('Background wake-word listening is available only in the BOZZ desktop app.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This device does not provide a microphone capture API.')
  }
  const startGeneration = ++generation
  const assertCurrent = () => {
    if (startGeneration !== generation) throw new Error('Wake-word start was cancelled. The microphone remains off.')
  }
  publish({ phase: 'starting', detail: 'Loading the validated local model. The microphone is still off.' })

  try {
    const ws = new WebSocket(websocketUrl())
    socket = ws
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('Could not connect to the local wake-word service.')), { once: true })
      ws.addEventListener('close', () => reject(new Error('The local wake-word service closed the connection.')), { once: true })
    })
    ws.send(JSON.stringify({ type: 'start', consent: true }))
    await waitForServerReady(ws)
    assertCurrent()

    // Ask the OS for microphone access only after the local model is ready.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    assertCurrent()
    const AudioContextConstructor = window.AudioContext
    context = new AudioContextConstructor({ sampleRate: 16000 })
    await context.resume()
    assertCurrent()
    if (context.sampleRate !== 16000) {
      throw new Error(`The audio device opened at ${context.sampleRate} Hz; BOZZ requires 16 kHz input for this model.`)
    }

    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(4096, 1, 1)
    silentGain = context.createGain()
    silentGain.gain.value = 0

    processor.onaudioprocess = (event) => {
      if (!socket || socket.readyState !== WebSocket.OPEN || state.phase !== 'listening') return
      if (socket.bufferedAmount > 12800) {
        void stopInternal({ phase: 'error', detail: 'Local processing fell behind. Listening stopped to avoid delayed audio.' })
        return
      }
      const input = event.inputBuffer.getChannelData(0)
      for (let i = 0; i < input.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, input[i]))
        frame[frameOffset] = sample < 0 ? sample * 32768 : sample * 32767
        frameOffset += 1
        if (frameOffset === frame.length) {
          const payload = frame.slice()
          socket.send(payload.buffer)
          frameOffset = 0
        }
      }
      event.outputBuffer.getChannelData(0).fill(0)
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(context.destination)

    const activeSocket = ws
    activeSocket.addEventListener('message', (event) => {
      let message: { type?: string; score?: number; message?: string }
      try { message = JSON.parse(String(event.data)) as typeof message } catch { return }
      if (message.type === 'wake_detected') {
        void stopInternal({
          phase: 'detected',
          detail: 'BOZZ phrase detected. The microphone is now off. Press the mic button to speak.',
          score: message.score,
        }, false)
        try { window.bozzDesktop?.showMain() } catch { /* window may already be visible */ }
      } else if (message.type === 'error') {
        void stopInternal({ phase: 'error', detail: message.message ?? 'The local wake-word service reported an error.' }, false)
      }
    })
    activeSocket.addEventListener('close', () => {
      if (state.phase === 'listening') {
        void stopInternal({ phase: 'error', detail: 'The local wake-word connection ended. Microphone is off.' }, false)
      }
    })

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        void stopInternal({ phase: 'error', detail: 'Microphone access ended. Wake-word listening stopped.' }, false)
      }
    })

    const background = await window.bozzDesktop.setWakeWordActivity(true)
    if (!background.ok) throw new Error(background.reason ?? 'Could not enable visible tray monitoring.')
    publish({ phase: 'listening', detail: 'Local wake-word listening is active. Audio is processed on this PC and is not saved.' })
  } catch (caught) {
    if (startGeneration === generation) {
      await stopInternal({
        phase: 'error',
        detail: caught instanceof Error ? caught.message : 'Wake-word listening could not start.',
      })
    } else {
      await releaseAudio()
    }
    throw caught
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void stopInternal({ phase: 'off', detail: 'BOZZ closed; microphone released.' })
  })
}
