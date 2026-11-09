// Microphone loudness gate used only to confirm a clap. It reads time-domain
// amplitude, keeps a rolling noise floor, and stores no audio at all.
export class MicLevelGate {
  available = false
  detail: string | null = null

  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private data: Float32Array<ArrayBuffer> | null = null
  private timer: number | null = null
  private baseline = 0.02
  private lastSpike = 0

  async start(): Promise<boolean> {
    this.stop()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.available = false
      this.detail = 'This browser has no microphone API.'
      return false
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const context = new AudioContext()
      await context.resume()
      const source = context.createMediaStreamSource(this.stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.2
      source.connect(analyser)
      this.context = context
      this.analyser = analyser
      this.data = new Float32Array(analyser.fftSize)
      this.available = true
      this.detail = null
      this.timer = window.setInterval(() => this.sample(), 50)
      return true
    } catch (error) {
      this.stop()
      this.available = false
      this.detail =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone permission was denied; clap stays low-confidence.'
          : 'The microphone could not be started; clap stays low-confidence.'
      return false
    }
  }

  private sample(): void {
    if (!this.analyser || !this.data) return
    this.analyser.getFloatTimeDomainData(this.data)
    let sum = 0
    for (let index = 0; index < this.data.length; index += 1) {
      sum += this.data[index] * this.data[index]
    }
    const rms = Math.sqrt(sum / this.data.length)
    if (rms < this.baseline * 1.6) {
      this.baseline += (rms - this.baseline) * 0.05
    }
    if (rms > Math.max(0.09, this.baseline * 2.6)) {
      this.lastSpike = performance.now()
    }
  }

  consumeSpike(now: number, windowMs = 260): boolean {
    if (!this.available) return false
    if (this.lastSpike > 0 && now - this.lastSpike <= windowMs) {
      this.lastSpike = 0
      return true
    }
    return false
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.analyser?.disconnect()
    this.analyser = null
    this.data = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    if (this.context && this.context.state !== 'closed') void this.context.close()
    this.context = null
    this.available = false
    this.lastSpike = 0
  }
}
