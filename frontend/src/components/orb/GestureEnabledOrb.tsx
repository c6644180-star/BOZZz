import { useContext, useEffect, useRef, useState } from 'react'
import { BozzVoiceContext } from '../../context/BozzVoiceContext'
import { onTaskResult } from '../../services/taskSignal'
import { subscribeToWave } from '../../services/voiceAudio'
import { defaultSettings } from '../../services/localStore'
import { orbPalette, type OrbRenderQuality } from '../../theme/orbTheme'
import type { OrbState, ThemeName } from '../../types/bozz'
import { OrbSceneApi } from './orbScene'
import { HandTracker, type GestureMode, type TrackerStatus, type HandTrackerCallbacks } from './handTracker'
import { SkillForge, SkillSynthesisResult } from '../adaptive/skillForge'

export function GestureEnabledOrb({
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

  // --- Gesture Tracking State ---
  const [gestureMode, setGestureMode] = useState<'idle' | 'spin' | 'zoom'>('idle')
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus>({ hands: 0, mode: 'idle' })
  const [skillInProgress, setSkillInProgress] = useState(false)
  const [gestureSequence, setGestureSequence] = useState<string[]>([])
  const GESTURE_REQUIRED_LENGTH = 3

  // --- Skill Forge State ---
  const [forgeResult, setForgeResult] = useState<SkillSynthesisResult>({
    success: false,
  })

  // --- Initialize HandTracker when component mounts ---
  useEffect(() => {
    // Create references to video and canvas elements within the mount node
    const videoRef = mountRef.current?.querySelector('video.orb-video')
    const canvasRef = mountRef.current?.querySelector('canvas.orb-overlay')

    if (!videoRef || !canvasRef) {
      // If elements not yet rendered, try again after a short delay
      const retry = setTimeout(() => this.setupHandTracker(), 100)
      return () => clearTimeout(retry)
    }

    const callbacks: HandTrackerCallbacks = {
      onRotate: (deltaTheta: number, deltaPhi: number) => {
        // Apply rotation to orb scene - mirror delta for user perspective
        sceneRef.current?.rotate(-deltaTheta, -deltaPhi)
      },
      onZoom: (factor: number) => {
        // Apply zoom: factor > 1 = zoom in, factor < 1 = zoom out
        sceneRef.current?.zoom(factor)
      },
      onStatus: (status: TrackerStatus) => {
        setTrackerStatus(status)
        setGestureMode(status.mode)

        // Check for skill-creation sequence
        if (status.mode !== 'idle') {
          setGestureSequence(prev => {
            const updated = [...prev, status.mode]
            return updated.length > GESTURE_REQUIRED_LENGTH
              ? updated.slice(-GESTURE_REQUIRED_LENGTH)
              : updated
          })
        }
      },
    }

    const tracker = new HandTracker(
      videoRef as HTMLVideoElement,
      canvasRef as HTMLCanvasElement,
      callbacks,
    )

    tracker.start().catch((err) => {
      console.warn('Hand tracker start failed:', err)
    })

    return () => {
      tracker.stop()
    }
  }, [])

  // --- Skill Forge Trigger on Gesture Sequence ---
  useEffect(() => {
    // When sequence is complete, trigger skill forge
    if (gestureSequence.length === GESTURE_REQUIRED_LENGTH && !skillInProgress) {
      setSkillInProgress(true)

      // Use the gesture pattern as inspiration for the skill name
      const sequenceKey = gestureSequence.join('-')
      const skillGoal = `Create an orbital control skill inspired by ${sequenceKey} continuous gesture pattern`

      SkillForge.forgeSkill(skillGoal, `gesture_${sequenceKey}`, `User performed ${sequenceKey} gesture pattern`).then(
        (result: SkillSynthesisResult) => {
          setForgeResult(result)
          setSkillInProgress(false)
          // Reset sequence after processing
          setGestureSequence([])
          setForgeResult({ success: false })
        }
      )
    }
  }, [gestureSequence, skillInProgress])

  // --- Ripple & Other State ---
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
      clearTimeout(timer)
      timer = window.setTimeout(() => setRipple(null), 1200)
    })
    return () => {
      off()
      clearTimeout(timer)
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
          onGesture: (mode: GestureMode) => {
            setTrackerStatus(prev => ({ ...prev, mode }))
          },
          onEvolvingGesture: (gestureData: {
            mode: GestureMode
            duration: number
            pattern: string[]
          }) => {
            // Send to skill forge for self-evolution
            SkillForge.forgeSkill(
              `Enhance orbital control with ${gestureData.mode} gesture pattern (${gestureData.duration}s duration)`,
              `evolved_${gestureData.mode}`,
              `Self-evolving gesture from ${gestureData.duration}s of ${gestureData.mode} mode`
            ).then((result: SkillSynthesisResult) => {
              console.log('New evolved gesture skill activated:', result)
              // Could update UI to display new capability summary
            })
          },
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

  // --- Handle window visibility change ---
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return (
    <div
      className={`orb orb--${state}${ripple ? ` orb--ripple-${ripple}` : ''}`}
      data-paused={frozen ? 'true' : 'false'}
      role="img"
      aria-label={`BOZZ orb — ${state}`}
    >
      <div ref={mountRef} className="orb-canvas-host" />
      {failed && (
        <div className="orb-fallback" role="status">
          <span className="orb-fallback__ring" aria-hidden="true" />
          <p>3D orb unavailable</p>
          <small>{failed}</small>
        </div>
      )}
      {/* Gesture indication UI */}
      {skillInProgress && (
        <div className="orb-gesture-tooltip">
          <p>🌀 Gesture pattern detected!</p>
          <p>Analyzing gesture sequence for skill evolution...</p>
          <p>{forgeResult.success ? `Skill '${forgeResult.name}' synthesized!` : forgeResult.message || 'Processing...'}</p>
        </div>
      )}
      {/* Status display for debugging */}
      {settings.debugMode && (
        <div className="orb-debug-panel">
          <p>Hands: {trackerStatus.hands}</p>
          <p>Mode: {gestureMode}</p>
          <p>Gesture seq: {gestureSequence.join(', ')}</p>
          <p>Forge: {forgeResult.success ? 'Active' : 'Idle'}</p>
        </div>
      )}
    </div>
  )
}