import { useContext, useEffect, useState } from 'react'
import { BozzVoiceContext } from '../../context/BozzVoiceContext'
import { SkillForge, SkillSynthesisResult } from '../../adaptive/skillForge'
import { HandTracker, type GestureMode, type TrackerStatus, type HandTrackerCallbacks } from './handTracker'

export function GestureToggle() {
  const { settings } = useContext(BozzVoiceContext) ?? {}
  const [gestureEnabled, setGestureEnabled] = useState(false)
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus>({ hands: 0, mode: 'idle' })
  const [gestureSequence, setGestureSequence] = useState<string[]>([])
  const [skillInProgress, setSkillInProgress] = useState(false)
  const [forgeResult, setForgeResult] = useState<SkillSynthesisResult>({ success: false })

  // --- Initialize HandTracker ---
  useEffect(() => {
    // We'll set up references when the DOM is ready
    const checkElements = setInterval(() => {
      const video = document.querySelector('video.orb-video')
      const canvas = document.querySelector('canvas.orb-overlay')

      if (video && canvas) {
        clearInterval(checkElements)

        const callbacks: HandTrackerCallbacks = {
          onRotate: (deltaTheta: number, deltaPhi: number) => {
            // Could apply rotation to orb or show feedback
            console.log('Gesture rotate:', deltaTheta, deltaPhi)
          },
          onZoom: (factor: number) => {
            // Could apply zoom or show feedback
            console.log('Gesture zoom:', factor)
          },
          onStatus: (status: TrackerStatus) => {
            setTrackerStatus(status)
            setGestureSequence(prev => {
              const updated = [...prev, status.mode]
              return updated.length > 3 ? updated.slice(-3) : updated
            })
          },
        }

        const tracker = new HandTracker(video as HTMLVideoElement, canvas as HTMLCanvasElement, callbacks)

        tracker.start().catch((err) => {
          console.warn('Hand tracker failed:', err)
        })
      }
    }, 100)

    return () => clearInterval(checkElements)
  }, [])

  // --- Toggle Gesture Control ---
  const toggleGesture = () => {
    setGestureEnabled(prev => !prev)
    if (prev) {
      console.log('Gesture control enabled - tracking started')
    } else {
      console.log('Gesture control disabled')
    }
  }

  // --- Skill Forge Trigger ---
  useEffect(() => {
    if (gestureSequence.length === 3 && !skillInProgress) {
      setSkillInProgress(true)
      const sequenceKey = gestureSequence.join('-')
      SkillForge.forgeSkill(
        `Create orbital gesture skill from ${sequenceKey} pattern`,
        `gesture_${sequenceKey}`,
        `User performed ${sequenceKey} gesture pattern`
      ).then((result: SkillSynthesisResult) => {
        setForgeResult(result)
        setSkillInProgress(false)
        setGestureSequence([])
        setForgeResult({ success: false })
      })
    }
  }, [gestureSequence, skillInProgress])

  return (
    <div className="gesture-toggle-container" style={{ marginTop: '10px', padding: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', color: 'white' }}>
      <button
        onClick={toggleGesture}
        style={{
          background: gestureEnabled ? 'rgba(0,180,0,0.3)' : 'rgba(180,0,0,0.3)',
          border: 'none',
          color: 'white',
          padding: '6px 12px',
          borderRadius: '4px',
          cursor: gestureEnabled ? 'default' : 'pointer',
          fontSize: '12px',
        }}
        aria-label={gestureEnabled ? 'Disable gesture control' : 'Enable gesture control'}
      >
        {gestureEnabled ? '⛓️ Gesture Control: ON' : '⛓️ Gesture Control: OFF'}
      </button>

      {gestureEnabled && (
        <div style={{ marginTop: '8px', fontSize: '11px' }}>
          <p>Mode: {gestureStatus.mode || 'idle'}</p>
          <p>Seq: {gestureSequence.join(' → ')}</p>
          {skillInProgress && (
            <p>🔮 Forging new skill from gesture pattern...</p>
          )}
          {forgeResult.success && (
            <p style={{ color: 'lime' }}>✨ Skill '{forgeResult.name}' created!</p>
          )}
        </div>
      )}
    </div>
  )
}

// Helper to get status from last known
const getGestureStatus = (status: TrackerStatus) => status.mode