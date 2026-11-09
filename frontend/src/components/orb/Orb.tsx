import { useContext, useEffect, useRef, useState } from 'react'
import { BozzVoiceContext } from '../../context/BozzVoiceContext'
import { onTaskResult } from '../../services/taskSignal'
import { subscribeToWave } from '../../services/voiceAudio'
import { defaultSettings } from '../../services/localStore'
import { orbPalette, type OrbRenderQuality } from '../../theme/orbTheme'
import type { OrbState, ThemeName } from '../../types/bozz'
import type { OrbSceneApi } from './orbScene'

const STATE_LABEL: Record<OrbState, string> = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  error: 'error',
  offline: 'offline',
}

export function Orb({
  state,
  quality,
  paused = false,
  theme,
  reducedMotion,
  fps,
}: {
  state: OrbState
  quality?: OrbRenderQuality
  paused?: boolean
  theme?: ThemeName
  reducedMotion?: boolean
  fps?: number
}) {
  const settings = useContext(BozzVoiceContext)?.settings ?? defaultSettings
  const activeTheme = theme ?? settings.orbTheme
  const motionReduced = reducedMotion ?? settings.reduceMotion
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<OrbSceneApi | null>(null)
  const stateRef = useRef(state)
  const pausedRef = useRef(paused)
  const fpsRef = useRef(fps)
  const paletteRef = useRef(orbPalette(activeTheme))
  const [failed, setFailed] = useState<string | null>(null)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [ripple, setRipple] = useState<'success' | 'failure' | null>(null)
  const frozen = paused || hidden

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    let timer: number | undefined
    const off = onTaskResult((result) => {
      setRipple(result.ok ? 'success' : 'failure')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setRipple(null), 1200)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    stateRef.current = state
    sceneRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    pausedRef.current = paused
    sceneRef.current?.setPaused(frozen)
  }, [paused, frozen])

  useEffect(() => {
    fpsRef.current = fps
    if (fps !== undefined) sceneRef.current?.setFps(fps)
  }, [fps])

  useEffect(() => {
    paletteRef.current = orbPalette(activeTheme)
    sceneRef.current?.setPalette(paletteRef.current)
  }, [activeTheme])

  useEffect(() => subscribeToWave((_bins, level) => {
    sceneRef.current?.setLevel(level)
  }), [])

  useEffect(() => {
    let cancelled = false
    let scene: OrbSceneApi | null = null
    const mini = quality === 'mini'

    void import('./orbScene')
      .then(({ createOrbScene }) => {
        if (cancelled || !mountRef.current) return
        scene = createOrbScene(mountRef.current, {
          palette: paletteRef.current,
          quality: quality ?? settings.orbQuality,
          state: stateRef.current,
          reducedMotion: motionReduced,
          transparent: mini,
          minimal: mini,
          interactive: quality === undefined,
        })
        sceneRef.current = scene
        scene.setPaused(pausedRef.current || document.hidden)
        if (fpsRef.current !== undefined) scene.setFps(fpsRef.current)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setFailed(error instanceof Error ? error.message : 'The 3D renderer could not start.')
      })

    return () => {
      cancelled = true
      scene?.dispose()
      if (sceneRef.current === scene) sceneRef.current = null
    }
  }, [quality, settings.orbQuality, motionReduced])

  return (
    <div
      className={`orb orb--${state}${ripple ? ` orb--ripple-${ripple}` : ''}`}
      data-paused={frozen ? 'true' : 'false'}
      role="img"
      aria-label={`BOZZ orb — ${STATE_LABEL[state]}`}
    >
      <div ref={mountRef} className="orb-canvas-host" />
      {failed && (
        <div className="orb-fallback" role="status">
          <span className="orb-fallback__ring" aria-hidden="true" />
          <p>3D orb unavailable</p>
          <small>{failed}</small>
        </div>
      )}
    </div>
  )
}
