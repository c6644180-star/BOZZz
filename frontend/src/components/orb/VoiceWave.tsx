import { useEffect, useRef } from 'react'
import { subscribeToWave } from '../../services/voiceAudio'

const BAR_COUNT = 28
const FLAT = 'scaleY(0.08)'

export function VoiceWave({ active }: { active: boolean }) {
  const bars = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    const flatten = () => {
      for (const bar of bars.current) {
        if (bar) bar.style.transform = FLAT
      }
    }
    flatten()
    return subscribeToWave((bins) => {
      if (!bins.length) {
        flatten()
        return
      }
      const usable = Math.min(bins.length, 48)
      for (let index = 0; index < BAR_COUNT; index += 1) {
        const bin = bins[Math.min(usable - 1, Math.floor((index / BAR_COUNT) * usable))]
        const level = Math.pow(bin / 255, 0.85)
        const bar = bars.current[index]
        if (bar) bar.style.transform = `scaleY(${(0.08 + level * 0.92).toFixed(3)})`
      }
    })
  }, [])

  return (
    <div className={`voice-wave ${active ? 'is-active' : ''}`} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          ref={(node) => { bars.current[index] = node }}
        />
      ))}
    </div>
  )
}
