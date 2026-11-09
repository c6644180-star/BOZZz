import { useEffect, useRef, useState } from 'react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { useHgi } from '../hgi/hgiContext'
import { desktopBridge } from '../../services/desktopBridge'
import { setMiniModeActive } from '../../services/desktopMode'
import type { MiniConfig, MiniState } from '../../types/desktop'

/**
 * Lives in the hidden main window. It is the only place where microphone,
 * speech, camera and desktop-control state exist; the floating mini window is
 * a display plus a small action pad. Actions arrive from the mini window and
 * run through the exact same voice/HGI providers as full mode.
 */
export function MiniOrbBridge() {
  const { orbState, caption, settings, mic, toggleListening, stopVoice, pushToTalkStart, pushToTalkEnd } =
    useBozzVoice()
  const hgi = useHgi()
  const bridge = desktopBridge()

  const [emergencyFlash, setEmergencyFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    const onEmergency = () => {
      setEmergencyFlash(true)
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setEmergencyFlash(false), 5000)
    }
    window.addEventListener('bozz-emergency-stop', onEmergency)
    return () => {
      window.removeEventListener('bozz-emergency-stop', onEmergency)
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!bridge) return
    // Chromium keeps a hidden Electron window marked "visible", so HUD CSS
    // animations would otherwise keep running and burning CPU. Pause them
    // until the full window comes back.
    const apply = (mode: string) => {
      setMiniModeActive(mode === 'mini')
      document.documentElement.dataset.miniBackground = mode === 'mini' ? 'true' : 'false'
    }
    const off = bridge.onMiniMode(({ mode }) => apply(mode))
    void bridge.getMode().then(apply)
    return () => {
      off()
      setMiniModeActive(false)
      document.documentElement.dataset.miniBackground = 'false'
    }
  }, [bridge])

  const listening = mic.listening
  const micAvailable = mic.available
  const cameraActive = hgi.metrics.cameraActive
  const desktopOn = hgi.desktopEnabled && hgi.desktopConnection === 'connected'
  const emergency = emergencyFlash || hgi.desktopConnection === 'stopped'
  const approval = hgi.desktopApprovals[0] ?? null

  useEffect(() => {
    if (!bridge) return
    const payload: MiniState = {
      orbState,
      caption,
      listening,
      micAvailable,
      cameraActive,
      desktopOn,
      emergency,
      approval: approval
        ? {
            id: approval.approval_id,
            label: approval.label,
            tier: approval.tier,
            source: approval.source,
            target: approval.target,
            expiresInMs: approval.expires_in_ms,
          }
        : null,
    }
    bridge.publishMiniState(payload)
  }, [bridge, orbState, caption, listening, micAvailable, cameraActive, desktopOn, emergency, approval])

  const mini = settings.miniOrb
  useEffect(() => {
    if (!bridge) return
    const config: MiniConfig = {
      size: mini.size,
      opacity: mini.opacity,
      wander: mini.wander,
      wanderSpeed: mini.wanderSpeed,
      dock: mini.dock,
      monitor: mini.monitor,
      theme: settings.orbTheme,
      reduceMotion: settings.reduceMotion,
      captions: settings.captions,
      pauseOnBattery: mini.pauseOnBattery,
      pushToTalk: settings.pushToTalk,
      pushToTalkKey: settings.pushToTalkKey,
    }
    bridge.publishMiniConfig(config)
  }, [
    bridge,
    mini.size,
    mini.opacity,
    mini.wander,
    mini.wanderSpeed,
    mini.dock,
    mini.monitor,
    mini.pauseOnBattery,
    settings.orbTheme,
    settings.reduceMotion,
    settings.captions,
    settings.pushToTalk,
    settings.pushToTalkKey,
  ])

  const actionRef = useRef({ toggleListening, stopVoice, pushToTalkStart, pushToTalkEnd, approveDesktop: hgi.approveDesktop, listening })
  useEffect(() => {
    actionRef.current = {
      toggleListening,
      stopVoice,
      pushToTalkStart,
      pushToTalkEnd,
      approveDesktop: hgi.approveDesktop,
      listening,
    }
  }, [toggleListening, stopVoice, pushToTalkStart, pushToTalkEnd, hgi.approveDesktop, listening])

  useEffect(() => {
    if (!bridge) return
    return bridge.onMiniAction((action) => {
      const current = actionRef.current
      switch (action.type) {
        case 'listen':
          current.toggleListening()
          return
        case 'mute':
          if (current.listening) current.toggleListening()
          return
        case 'stop-speak':
          current.stopVoice()
          return
        case 'ptt-start':
          current.pushToTalkStart()
          return
        case 'ptt-end':
          current.pushToTalkEnd()
          return
        case 'approval':
          void current.approveDesktop(action.id, action.approve, 'mini')
          return
        case 'emergency-stop':
          window.dispatchEvent(new Event('bozz-emergency-stop'))
          return
        default:
          return
      }
    })
  }, [bridge])

  return null
}
