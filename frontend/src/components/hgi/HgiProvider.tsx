import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GestureEngine } from '../../hgi/engine/GestureEngine'
import { gestureBus } from '../../hgi/bus/GestureBus'
import { MicLevelGate } from '../../hgi/audio/micLevelGate'
import { Calibrator } from '../../hgi/calibration/calibrator'
import { OrbMode } from '../../hgi/modes/orbMode'
import { CursorMode } from '../../hgi/modes/cursorMode'
import { DesktopMode } from '../../hgi/modes/desktopMode'
import { DesktopSocket } from '../../hgi/desktop/desktopSocket'
import {
  addDesktopApp,
  addDesktopUrl,
  emergencyStopDesktop,
  fetchDesktopAllowlist,
  fetchDesktopStatus,
  removeDesktopApp,
  removeDesktopUrl,
  resolveDesktopApproval,
  runDesktopAction as runDesktopActionApi,
  setDesktopEnabled as setDesktopEnabledApi,
  setDesktopShortcuts,
  stopDesktopDictation as stopDesktopDictationApi,
  typeDictatedText,
  updateDesktopConfig,
} from '../../hgi/desktop/desktopSocket'
import { changeModulePermission, fetchModules } from '../../services/modules'
import { loadPermissionMirror } from '../../services/localStore'
import { pushToast } from '../../services/toast'
import { HgiSourceError } from '../../hgi/landmarks/LandmarkSource'
import {
  clearCalibration,
  loadCalibration,
  loadHgiSettings,
  sanitizeSettings,
  saveCalibration,
  saveHgiSettings,
} from '../../hgi/storage/settingsStore'
import { listTaughtGestures } from '../../hgi/storage/gestureDb'
import { DEFAULT_HGI_SETTINGS } from '../../hgi/types'
import type {
  CalibrationProfile,
  FeatureFrame,
  HandLandmarks,
  HgiMetrics,
  HgiMode,
  HgiSettings,
  TaughtGesture,
  RecordedSession,
} from '../../hgi/types'
import type {
  DesktopActionRecord,
  DesktopActionResult,
  DesktopAllowlist,
  DesktopConnection,
  DesktopStateChip,
  DesktopStatus,
  DictationState,
  PendingApproval,
} from '../../hgi/desktop/desktopSocket'
import type { CalibrationUpdate } from '../../hgi/calibration/calibrator'
import type { RecognitionFrame } from '../../hgi/engine/GestureEngine'
import type { CursorListener, FeatureListener, HgiContextValue, PreviewListener, RecognitionListener } from './hgiContext'
import { HgiContext } from './hgiContext'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { isMiniModeActive, MINI_MODE_EVENT } from '../../services/desktopMode'
import { ADAPTIVE_SETTINGS_EVENT, loadAdaptiveSettings } from '../../adaptive/settings'
import type { AdaptiveSettings } from '../../adaptive/types'
import { diagnostics } from '../../adaptive/diagnostics'
import { undoStack } from '../../adaptive/undo'
import { TapTracker } from '../../adaptive/tapTracker'
import { mapCameraToViewport } from '../../hgi/geometry'

const MIC_OPT_IN_KEY = 'bozz.hgi.micOptIn.v1'

const OFF_METRICS: HgiMetrics = {
  enabled: false,
  starting: false,
  modelReady: false,
  cameraActive: false,
  permission: 'idle',
  fps: 0,
  latencyMs: 0,
  trackingConfidence: 0,
  hands: 0,
  currentGesture: null,
  gestureConfidence: 0,
  shortPinches: 0,
  pinchEvents: 0,
  frameCount: 0,
  source: null,
  paused: false,
  quality: DEFAULT_HGI_SETTINGS.quality,
  micAvailable: false,
  note: 'Gestures are off — the camera is released.',
}

function messageOf(error: unknown): string {
  if (error instanceof HgiSourceError) {
    if (error.code === 'permission') return 'Camera permission was denied. Allow the camera in your browser, then try again.'
    if (error.code === 'unavailable') return 'This browser or device does not expose a camera to the page.'
    if (error.code === 'model') return 'The local hand-tracking model could not be loaded from /mediapipe.'
    return error.message
  }
  return error instanceof Error ? error.message : 'The gesture engine hit an unknown error.'
}

export function HgiProvider({ children }: { children: ReactNode }) {
  const { pauseInteraction, stopVoice, pushToTalkStart, pushToTalkEnd } = useBozzVoice()
  const [settings, setSettings] = useState<HgiSettings>(() => loadHgiSettings())
  const [calibration, setCalibration] = useState<CalibrationProfile | null>(() => loadCalibration())
  const [customGestures, setCustomGestures] = useState<TaughtGesture[]>([])
  const [enabled, setEnabled] = useState(false)
  const [starting, setStarting] = useState(false)
  const [mode, setModeState] = useState<HgiMode>('orb')
  const [paused, setPaused] = useState(false)
  const [metrics, setMetrics] = useState<HgiMetrics>(() => ({ ...OFF_METRICS, quality: loadHgiSettings().quality }))
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calibrationUpdate, setCalibrationUpdate] = useState<CalibrationUpdate | null>(null)
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingFrames, setRecordingFrames] = useState(0)
  const [replaying, setReplaying] = useState(false)
  const [micAvailable, setMicAvailable] = useState(false)
  const [micDetail, setMicDetail] = useState<string | null>(null)
  const [micOptIn, setMicOptInState] = useState(() => {
    try {
      return localStorage.getItem(MIC_OPT_IN_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null)
  const [desktopAllowlist, setDesktopAllowlist] = useState<DesktopAllowlist | null>(null)
  const [desktopApprovals, setDesktopApprovals] = useState<PendingApproval[]>([])
  const [desktopActions, setDesktopActions] = useState<DesktopActionRecord[]>([])
  const [desktopDictation, setDesktopDictation] = useState<DictationState | null>(null)
  const [desktopLastResult, setDesktopLastResult] = useState<DesktopActionResult | null>(null)
  const [desktopPermissionGranted, setDesktopPermissionGranted] = useState(() => loadPermissionMirror().hgi?.device_control === true)
  const [desktopPermissionBusy, setDesktopPermissionBusy] = useState(false)
  const [desktopEnabled, setDesktopEnabledState] = useState(false)
  const [desktopBusy, setDesktopBusy] = useState(false)
  const [desktopConnection, setDesktopConnection] = useState<DesktopConnection>('disconnected')
  const [desktopDetail, setDesktopDetail] = useState<string | null>(null)
  const [desktopLoadError, setDesktopLoadError] = useState<string | null>(null)

  const settingsRef = useRef(settings)
  const adaptiveRef = useRef<AdaptiveSettings>(loadAdaptiveSettings())
  const calibrationRef = useRef(calibration)
  const customRef = useRef(customGestures)
  const engineRef = useRef<GestureEngine | null>(null)
  const micRef = useRef<MicLevelGate | null>(null)
  const orbRef = useRef<OrbMode | null>(null)
  const cursorRef = useRef<CursorMode | null>(null)
  const desktopRef = useRef<DesktopMode | null>(null)
  const socketRef = useRef<DesktopSocket | null>(null)
  const desktopEnabledRef = useRef(false)
  const desktopApprovalsRef = useRef<PendingApproval[]>([])
  const desktopApproveRef = useRef<(approve: boolean, via?: string) => Promise<DesktopActionResult | null>>(async () => null)
  const noteActionResultRef = useRef<(result: DesktopActionResult) => void>(() => {})
  const pushToTalkStartRef = useRef<() => void>(() => {})
  const pushToTalkEndRef = useRef<() => void>(() => {})
  const desktopRefreshTimer = useRef<number | null>(null)
  const desktopConfigTimer = useRef<number | null>(null)
  const enabledRef = useRef(false)
  const startingRef = useRef(false)
  const modeRef = useRef<HgiMode>('orb')
  const calibratorRef = useRef<Calibrator | null>(null)
  const lastTrackingAt = useRef(0)
  const hiddenSince = useRef(0)
  const recordingTimer = useRef<number | null>(null)
  const previewListeners = useRef(new Set<PreviewListener>())
  const featureListeners = useRef(new Set<FeatureListener>())
  const recognitionListeners = useRef(new Set<RecognitionListener>())
  const cursorListeners = useRef(new Set<CursorListener>())
  const noticeTimer = useRef<number | null>(null)
  const lastPauseToggle = useRef(0)

  useEffect(() => {
    settingsRef.current = settings
    calibrationRef.current = calibration
    customRef.current = customGestures
    modeRef.current = mode
  }, [settings, calibration, customGestures, mode])

  const showNotice = useCallback((message: string | null) => {
    setNotice(message)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    if (message) {
      noticeTimer.current = window.setTimeout(() => setNotice(null), 7000)
    }
  }, [])

  const applyOrbTransform = useCallback((rotation: number, zoom: number) => {
    const root = document.documentElement
    root.style.setProperty('--hgi-orb-rotate', `${rotation.toFixed(2)}deg`)
    root.style.setProperty('--hgi-orb-zoom', zoom.toFixed(3))
  }, [])

  const resetOrb = useCallback(() => {
    const before = orbRef.current?.current
    orbRef.current?.reset()
    applyOrbTransform(0, 1)
    if (before && (before.rotation !== 0 || before.zoom !== 1)) {
      undoStack.push('orb reset', () => {
        orbRef.current?.restore(before.rotation, before.zoom)
        applyOrbTransform(before.rotation, before.zoom)
      })
    }
  }, [applyOrbTransform])

  const handleFeatures = useCallback(
    (frame: FeatureFrame) => {
      for (const listener of featureListeners.current) listener(frame)
      const calibrator = calibratorRef.current
      if (calibrator?.running) {
        const update = calibrator.tick(frame.hands, frame.timestamp)
        if (update) {
          setCalibrationUpdate(update)
          if (update.done && update.profile) {
            calibratorRef.current = null
            saveCalibration(update.profile)
            setCalibration(update.profile)
            calibrationRef.current = update.profile
            engineRef.current?.setCalibration(update.profile)
            const next = {
              ...settingsRef.current,
              pinchOn: update.profile.pinchOn,
              pinchOff: update.profile.pinchOff,
            }
            settingsRef.current = next
            setSettings(next)
            saveHgiSettings(next)
            showNotice(
              `Calibration saved: pinch on ${update.profile.pinchOn}, off ${update.profile.pinchOff} (${update.profile.sampleCounts.pinch} pinch samples).`,
            )
          }
        }
      }
    },
    [showNotice],
  )
  const handleFeaturesRef = useRef(handleFeatures)
  useEffect(() => {
    handleFeaturesRef.current = handleFeatures
  }, [handleFeatures])

  const stopLiveRef = useRef<() => void>(() => {})

  const handleMetrics = useCallback((next: HgiMetrics) => {
    setMetrics(next)
    if (next.hands > 0) lastTrackingAt.current = performance.now()
    setMicAvailable(next.micAvailable)
    setPaused(next.paused)
  }, [])
  const handleMetricsRef = useRef(handleMetrics)
  useEffect(() => {
    handleMetricsRef.current = handleMetrics
  }, [handleMetrics])

  const handleRecognition = useCallback((frame: RecognitionFrame) => {
    if (frame.handsCount > 0) lastTrackingAt.current = performance.now()
    for (const listener of recognitionListeners.current) listener(frame)
  }, [])
  const handleRecognitionRef = useRef(handleRecognition)
  useEffect(() => {
    handleRecognitionRef.current = handleRecognition
  }, [handleRecognition])

  const handlePreview = useCallback((hands: HandLandmarks[], timestamp: number) => {
    for (const listener of previewListeners.current) listener(hands, timestamp)
  }, [])
  const handlePreviewRef = useRef(handlePreview)
  useEffect(() => {
    handlePreviewRef.current = handlePreview
  }, [handlePreview])

  const handleCursor = useCallback((x: number, y: number) => {
    setCursorVisible(true)
    for (const listener of cursorListeners.current) listener(x, y)
  }, [])
  const handleCursorRef = useRef(handleCursor)
  useEffect(() => {
    handleCursorRef.current = handleCursor
  }, [handleCursor])

  const stopModes = useCallback(() => {
    orbRef.current?.stop()
    cursorRef.current?.stop()
    desktopRef.current?.stop()
    desktopRef.current = null
    setCursorVisible(false)
  }, [])

  const buildEngine = useCallback(() => {
    const mic = micRef.current
    const engine = new GestureEngine(
      settingsRef.current,
      calibrationRef.current,
      customRef.current,
      mic,
      true,
      {
        onMetrics: (value) => handleMetricsRef.current(value),
        onRecognition: (value) => handleRecognitionRef.current(value),
        onFeatures: (value) => handleFeaturesRef.current(value),
        onPreview: (hands, timestamp) => handlePreviewRef.current(hands, timestamp),
      },
      adaptiveRef.current.gestures,
    )
    return engine
  }, [])

  const startEngine = useCallback(async () => {
    if (enabledRef.current || startingRef.current) return
    startingRef.current = true
    setStarting(true)
    setError(null)
    try {
      if (micOptIn && settingsRef.current.micConfirmClap) {
        const mic = micRef.current ?? new MicLevelGate()
        micRef.current = mic
        const ok = await mic.start()
        setMicAvailable(ok)
        setMicDetail(mic.detail)
      }
      const engine = buildEngine()
      engineRef.current = engine
      await engine.start()
      enabledRef.current = true
      setEnabled(true)
      setPreviewEpoch((value) => value + 1)
      const stream = engine.stream
      stream?.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (!enabledRef.current) return
          showNotice('Camera stopped, so gestures were switched off.')
          stopLiveRef.current()
        })
      })
    } catch (caught) {
      engineRef.current?.stop()
      engineRef.current = null
      enabledRef.current = false
      setEnabled(false)
      setError(messageOf(caught))
      setMetrics({ ...OFF_METRICS, quality: settingsRef.current.quality })
      micRef.current?.stop()
      setMicAvailable(false)
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [buildEngine, micOptIn, showNotice])

  const refreshDesktopRef = useRef<() => Promise<void>>(async () => {})

  const applyDesktopSnapshot = useCallback((status: DesktopStatus) => {
    setDesktopStatus(status)
    if (status.pending_approvals) {
      setDesktopApprovals(status.pending_approvals)
      desktopApprovalsRef.current = status.pending_approvals
    }
    if (status.recent_actions) setDesktopActions(status.recent_actions)
    if (status.dictation) setDesktopDictation(status.dictation)
  }, [])

  const refreshDesktopPermission = useCallback(async () => {
    try {
      const snapshot = await fetchModules()
      const hgi = snapshot.modules.find((module) => module.id === 'hgi')
      const granted = hgi?.permissions.some((item) => item.id === 'device_control' && item.granted) ?? false
      setDesktopPermissionGranted(granted)
      return granted
    } catch {
      const granted = loadPermissionMirror().hgi?.device_control === true
      setDesktopPermissionGranted(granted)
      return granted
    }
  }, [])

  const clearDesktopSession = useCallback(
    (reason: string | null, connection: DesktopConnection = 'disconnected') => {
      desktopEnabledRef.current = false
      setDesktopEnabledState(false)
      setDesktopConnection(connection)
      setDesktopApprovals([])
      desktopApprovalsRef.current = []
      setDesktopDictation(null)
      desktopRef.current?.stop()
      desktopRef.current = null
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
      if (reason) {
        setDesktopDetail(reason)
        showNotice(reason)
        pushToast('warning', 'Desktop control off', reason)
      }
    },
    [showNotice],
  )

  const releaseDesktop = useCallback(
    async (reason: string | null, emergency = false) => {
      const wasEnabled = desktopEnabledRef.current
      clearDesktopSession(reason, emergency ? 'stopped' : 'disconnected')
      if (!wasEnabled) return
      try {
        const status = emergency ? await emergencyStopDesktop() : await setDesktopEnabledApi(false)
        applyDesktopSnapshot(status)
        setDesktopLoadError(null)
      } catch (caught) {
        setDesktopLoadError(messageOf(caught))
      }
    },
    [applyDesktopSnapshot, clearDesktopSession],
  )

  const wireSocket = useCallback(
    (socket: DesktopSocket) => {
      socket.onState = (socketState) => {
        // A socket that was already released must not overwrite the current banner.
        if (socketRef.current !== socket) return
        setDesktopConnection(socketState.connection)
        setDesktopDetail(socketState.detail)
        if (socketState.pendingApprovals) {
          setDesktopApprovals(socketState.pendingApprovals)
          desktopApprovalsRef.current = socketState.pendingApprovals
        }
        if (socketState.dictation) setDesktopDictation(socketState.dictation)
        if (socketState.lastAction) {
          const action = socketState.lastAction
          setDesktopActions((prev) => [
            action,
            ...prev.filter((item) => item.at !== action.at || item.action_id !== action.action_id),
          ].slice(0, 10))
        }
        if (socketState.state || socketState.enabled !== undefined) {
          setDesktopStatus((prev) =>
            prev
              ? {
                  ...prev,
                  state: (socketState.state ?? prev.state) as DesktopStateChip | undefined,
                  enabled: socketState.enabled ?? prev.enabled,
                  emergency_stopped: socketState.emergencyStopped,
                  pending_approvals: socketState.pendingApprovals ?? prev.pending_approvals,
                  dictation: socketState.dictation ?? prev.dictation,
                  last_action: socketState.lastAction ?? prev.last_action,
                }
              : prev,
          )
        }
        if (socketState.emergencyStopped) {
          clearDesktopSession(
            'Emergency stop is latched. Restart the backend after checking the controls, or re-enable after a restart.',
            'stopped',
          )
          return
        }
        if (socketState.enabled === false && desktopEnabledRef.current) {
          clearDesktopSession(socketState.detail ?? 'Desktop control was switched off by the backend.')
          return
        }
        if (!desktopEnabledRef.current) return
        if (socketState.connection === 'disconnected' || socketState.connection === 'error') {
          void releaseDesktop(`Desktop control auto-disabled: ${socketState.detail ?? 'the local socket closed.'}`)
        }
      }
      socket.onResult = (result) => {
        noteActionResultRef.current(result)
      }
    },
    [clearDesktopSession, releaseDesktop],
  )

  const attachDesktopSocket = useCallback(
    async (token: string) => {
      if (socketRef.current) return
      const socket = new DesktopSocket()
      wireSocket(socket)
      socketRef.current = socket
      desktopEnabledRef.current = true
      setDesktopEnabledState(true)
      setDesktopConnection('connecting')
      try {
        await socket.connect(token)
        setDesktopConnection('connected')
        setDesktopDetail(null)
        lastTrackingAt.current = performance.now()
        socket.sendPresence({ hidden: document.hidden })
      } catch (caught) {
        clearDesktopSession(messageOf(caught))
        setDesktopLoadError(messageOf(caught))
        await setDesktopEnabledApi(false).catch(() => undefined)
      }
    },
    [clearDesktopSession, wireSocket],
  )

  const refreshDesktop = useCallback(async () => {
    try {
      const status = await fetchDesktopStatus()
      applyDesktopSnapshot(status)
      setDesktopLoadError(null)
      if (status.emergency_stopped) {
        desktopEnabledRef.current = false
        setDesktopEnabledState(false)
        setDesktopConnection('stopped')
        setDesktopDetail('Emergency stop is latched. Restart the backend after checking the pointer and control area.')
      } else if (!status.enabled && desktopEnabledRef.current) {
        clearDesktopSession(status.disable_reason ?? 'Desktop control is off in the backend.')
      }
      await refreshDesktopPermission()
    } catch (caught) {
      setDesktopStatus(null)
      setDesktopLoadError(
        caught instanceof Error
          ? `${caught.message} Start the backend with uvicorn to use desktop control.`
          : 'The desktop control endpoint is unreachable.',
      )
    }
  }, [applyDesktopSnapshot, clearDesktopSession, refreshDesktopPermission])

  const refreshDesktopAllowlist = useCallback(async () => {
    try {
      setDesktopAllowlist(await fetchDesktopAllowlist())
    } catch (caught) {
      setDesktopLoadError(messageOf(caught))
    }
  }, [])

  useEffect(() => {
    refreshDesktopRef.current = refreshDesktop
  }, [refreshDesktop])

  const stopLive = useCallback(() => {
    if (recordingTimer.current !== null) {
      window.clearInterval(recordingTimer.current)
      recordingTimer.current = null
    }
    setRecording(false)
    setRecordingFrames(0)
    calibratorRef.current?.cancel()
    calibratorRef.current = null
    setCalibrationUpdate(null)
    const engine = engineRef.current
    engineRef.current = null
    engine?.stop()
    enabledRef.current = false
    setEnabled(false)
    setPaused(false)
    stopModes()
    applyOrbTransform(0, 1)
    micRef.current?.stop()
    setMicAvailable(false)
    setCursorVisible(false)
    setMetrics({ ...OFF_METRICS, quality: settingsRef.current.quality })
    setPreviewEpoch((value) => value + 1)
    if (desktopEnabledRef.current) void releaseDesktop('Desktop control auto-disabled because the camera stopped.')
  }, [applyOrbTransform, releaseDesktop, stopModes])
  useEffect(() => {
    stopLiveRef.current = stopLive
  }, [stopLive])

  const stopGestures = useCallback(
    (reason?: string) => {
      stopLive()
      setError(null)
      if (reason) showNotice(reason)
    },
    [showNotice, stopLive],
  )

  const toggleEnabled = useCallback(async () => {
    if (enabledRef.current) {
      stopGestures('Gestures off — camera released.')
      return
    }
    await startEngine()
  }, [startEngine, stopGestures])

  const setMode = useCallback(
    (next: HgiMode) => {
      setModeState(next)
      modeRef.current = next
      setCursorVisible(false)
      if (next === 'desktop' && !desktopEnabledRef.current) {
        showNotice('Desktop mode selected. Turn on Desktop Control in Gesture Lab to move the real mouse.')
      }
    },
    [showNotice],
  )

  const cycleMode = useCallback(() => {
    const order: HgiMode[] = ['orb', 'cursor', 'desktop']
    const next = order[(order.indexOf(modeRef.current) + 1) % order.length]
    setMode(next)
  }, [setMode])

  const togglePause = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setPaused(!engine.isPaused)
    setPaused(engine.isPaused)
    showNotice(engine.isPaused ? 'Gesture commands paused. Press P or hold an open palm for 1 s to resume.' : 'Gesture commands resumed.')
  }, [showNotice])

  const resetResume = useCallback(() => {
    const engine = engineRef.current
    if (engine?.isPaused) {
      engine.setPaused(false)
      setPaused(false)
    }
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<HgiSettings>) => {
      const current = settingsRef.current
      const merged = sanitizeSettings({
        ...current,
        ...patch,
        desktop: { ...current.desktop, ...patch.desktop },
        bindings: { ...current.bindings, ...patch.bindings },
      })
      const qualityChanged = merged.quality !== current.quality && enabledRef.current
      settingsRef.current = merged
      setSettings(merged)
      saveHgiSettings(merged)
      engineRef.current?.setSettings(merged)
      orbRef.current?.updateBindings(merged.bindings)
      cursorRef.current?.updateBindings(merged.bindings)
      desktopRef.current?.updateBindings(merged.bindings)
      desktopRef.current?.updateSettings({
        sensitivity: merged.desktop.sensitivity,
        smoothing: merged.desktop.smoothing,
        minConfidence: merged.minConfidence,
        clickDelayMs: merged.desktop.clickDelayMs,
      })
      socketRef.current?.send({
        type: 'configure',
        area: merged.desktop.area,
        sensitivity: merged.desktop.sensitivity,
        smoothing: merged.desktop.smoothing,
      })
      if (qualityChanged) {
        showNotice(`Quality changed to ${merged.quality}. Restarting the camera with the new inference cap.`)
        const engine = engineRef.current
        engineRef.current = null
        engine?.stop()
        enabledRef.current = false
        setEnabled(false)
        stopModes()
        applyOrbTransform(0, 1)
        setCalibrationUpdate(null)
        void startEngine()
      }
    },
    [applyOrbTransform, showNotice, startEngine, stopModes],
  )

  const startCalibration = useCallback(() => {
    if (!enabledRef.current) {
      showNotice('Start gestures before calibrating.')
      return
    }
    resetResume()
    const calibrator = new Calibrator()
    calibratorRef.current = calibrator
    setCalibrationUpdate(calibrator.start(performance.now()))
  }, [resetResume, showNotice])

  const cancelCalibration = useCallback(() => {
    calibratorRef.current?.cancel()
    calibratorRef.current = null
    setCalibrationUpdate(null)
  }, [])

  const saveCalibrationProfile = useCallback(
    (profile: CalibrationProfile) => {
      saveCalibration(profile)
      setCalibration(profile)
      calibrationRef.current = profile
      engineRef.current?.setCalibration(profile)
      const next = { ...settingsRef.current, pinchOn: profile.pinchOn, pinchOff: profile.pinchOff }
      settingsRef.current = next
      setSettings(next)
      saveHgiSettings(next)
      showNotice('Hand calibration saved and applied.')
    },
    [showNotice],
  )

  const clearCalibrationProfile = useCallback(() => {
    clearCalibration()
    setCalibration(null)
    calibrationRef.current = null
    engineRef.current?.setCalibration(null)
    const next = {
      ...settingsRef.current,
      pinchOn: DEFAULT_HGI_SETTINGS.pinchOn,
      pinchOff: DEFAULT_HGI_SETTINGS.pinchOff,
    }
    settingsRef.current = next
    setSettings(next)
    saveHgiSettings(next)
    showNotice('Calibration cleared. Default pinch thresholds are active.')
  }, [showNotice])

  const refreshCustomGestures = useCallback(async () => {
    try {
      const gestures = await listTaughtGestures()
      setCustomGestures(gestures)
      customRef.current = gestures
      engineRef.current?.setCustomGestures(gestures)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }, [])

  const captureSamples = useCallback((durationMs = 2600, target = 40) => {
    return new Promise<number[][]>((resolve, reject) => {
      if (!enabledRef.current) {
        reject(new Error('Start gestures before recording a sample.'))
        return
      }
      const samples: number[][] = []
      const startedAt = performance.now()
      let finished = false
      let timer = 0
      const finish = () => {
        if (finished) return
        finished = true
        window.clearTimeout(timer)
        unsubscribe()
        resolve(samples)
      }
      const unsubscribe = (() => {
        const listener: FeatureListener = (frame) => {
          const hand = frame.hands.find((item) => item.score > 0.5)
          if (hand) samples.push([...hand.vector])
          if (samples.length >= target || performance.now() - startedAt >= durationMs) finish()
        }
        featureListeners.current.add(listener)
        return () => featureListeners.current.delete(listener)
      })()
      timer = window.setTimeout(finish, durationMs + 400)
    })
  }, [])

  const subscribePreview = useCallback((listener: PreviewListener) => {
    previewListeners.current.add(listener)
    return () => previewListeners.current.delete(listener)
  }, [])
  const subscribeFeatures = useCallback((listener: FeatureListener) => {
    featureListeners.current.add(listener)
    return () => featureListeners.current.delete(listener)
  }, [])
  const subscribeRecognition = useCallback((listener: RecognitionListener) => {
    recognitionListeners.current.add(listener)
    return () => recognitionListeners.current.delete(listener)
  }, [])
  const subscribeCursor = useCallback((listener: CursorListener) => {
    cursorListeners.current.add(listener)
    return () => cursorListeners.current.delete(listener)
  }, [])
  const getVideoElement = useCallback(() => engineRef.current?.video ?? null, [])

  const beginRecording = useCallback(() => {
    const engine = engineRef.current
    if (!engine || !enabledRef.current) {
      showNotice('Start gestures before recording a session.')
      return
    }
    engine.startRecording()
    setRecording(true)
    setRecordingFrames(0)
    if (recordingTimer.current !== null) window.clearInterval(recordingTimer.current)
    recordingTimer.current = window.setInterval(() => {
      setRecordingFrames(engine.recordingFrames)
    }, 250)
  }, [showNotice])

  const endRecording = useCallback(() => {
    if (recordingTimer.current !== null) {
      window.clearInterval(recordingTimer.current)
      recordingTimer.current = null
    }
    setRecording(false)
    setRecordingFrames(0)
    return engineRef.current?.stopRecording() ?? null
  }, [])

  const replaySession = useCallback(
    async (session: RecordedSession, speed = 1) => {
      if (enabledRef.current) {
        stopGestures('Live gestures stopped so the recorded session can replay.')
      }
      setReplaying(true)
      setError(null)
      const engine = buildEngine()
      engineRef.current = engine
      setPreviewEpoch((value) => value + 1)
      try {
        return await engine.replay(session.frames, speed)
      } finally {
        engineRef.current = null
        setReplaying(false)
        setMetrics({ ...OFF_METRICS, quality: settingsRef.current.quality })
        setPreviewEpoch((value) => value + 1)
      }
    },
    [buildEngine, stopGestures],
  )

  const noteActionResult = useCallback(
    (result: DesktopActionResult) => {
      setDesktopLastResult(result)
      if (result.status === 'blocked') {
        pushToast('error', 'Action blocked for safety', result.message, 8000)
      } else if (result.status === 'rejected' || result.status === 'failed') {
        pushToast('warning', result.label ?? 'Desktop action', result.message, 7000)
      } else if (result.status === 'approval_required') {
        pushToast('warning', 'Approval needed', result.message, 10000)
      } else if (result.message) {
        showNotice(result.message)
      }
      if (desktopRefreshTimer.current !== null) window.clearTimeout(desktopRefreshTimer.current)
      desktopRefreshTimer.current = window.setTimeout(() => {
        desktopRefreshTimer.current = null
        void refreshDesktopRef.current()
      }, 200)
    },
    [showNotice],
  )
  useEffect(() => {
    noteActionResultRef.current = noteActionResult
  }, [noteActionResult])

  const grantDesktopPermission = useCallback(async () => {
    setDesktopPermissionBusy(true)
    try {
      await changeModulePermission('hgi', 'device_control', true)
      const granted = await refreshDesktopPermission()
      showNotice(
        granted
          ? 'HGI device-control permission granted. Desktop control can now be switched on.'
          : 'The backend did not confirm the device-control grant.',
      )
      return granted
    } catch (caught) {
      const message = messageOf(caught)
      setDesktopLoadError(message)
      showNotice(`Could not grant the device-control permission: ${message}`)
      return false
    } finally {
      setDesktopPermissionBusy(false)
    }
  }, [refreshDesktopPermission, showNotice])

  const enableDesktop = useCallback(async () => {
    if (desktopEnabledRef.current) return
    setDesktopBusy(true)
    setDesktopLoadError(null)
    try {
      const granted = await refreshDesktopPermission()
      if (!granted) {
        const message = 'Desktop control is off. Grant the HGI device-control permission first.'
        setDesktopLoadError(message)
        showNotice(message)
        return
      }
      const status = await setDesktopEnabledApi(true)
      applyDesktopSnapshot(status)
      if (!status.enabled) {
        setDesktopLoadError(status.detail ?? 'The backend refused to enable desktop control.')
        return
      }
      if (!status.available) {
        setDesktopLoadError('The backend cannot drive a mouse on this machine — check pyautogui and pynput.')
        await setDesktopEnabledApi(false).catch(() => undefined)
        return
      }
      await attachDesktopSocket(status.token)
      if (!socketRef.current) return
      void refreshDesktopAllowlist()
      showNotice('Desktop control ON. Ctrl+Alt+Q, the screen-corner fail-safe, or “BOZZ stop” stops it immediately.')
    } catch (caught) {
      const message = messageOf(caught)
      setDesktopLoadError(message)
      showNotice(message)
      socketRef.current?.close()
      socketRef.current = null
      desktopEnabledRef.current = false
      setDesktopEnabledState(false)
      setDesktopConnection('error')
      await setDesktopEnabledApi(false).catch(() => undefined)
    } finally {
      setDesktopBusy(false)
    }
  }, [applyDesktopSnapshot, attachDesktopSocket, refreshDesktopAllowlist, refreshDesktopPermission, showNotice])

  const disableDesktop = useCallback(
    async (reason?: string) => {
      await releaseDesktop(reason ?? 'Desktop control turned off.', false)
    },
    [releaseDesktop],
  )

  const emergencyStop = useCallback(
    async (reason?: string) => {
      const hadDesktop = desktopEnabledRef.current
      // Clear the flag first so stopLive() does not also report a camera auto-disable.
      desktopEnabledRef.current = false
      pauseInteraction(reason ?? 'Emergency stop activated. Voice, camera, gestures, and desktop control are stopped.')
      stopLive()
      showNotice('EMERGENCY STOP — camera released, gestures off, desktop mouse stopped. Nothing was deleted.')
      if (!hadDesktop) {
        // Do not latch the backend when it was never driving the mouse.
        setDesktopConnection((current) => (current === 'stopped' ? current : 'disconnected'))
        return
      }
      clearDesktopSession(null, 'stopped')
      setDesktopDetail('Emergency stop is latched. Restart the backend to clear it.')
      try {
        const status = await emergencyStopDesktop()
        applyDesktopSnapshot(status)
        setDesktopLoadError(null)
      } catch (caught) {
        setDesktopLoadError(messageOf(caught))
      }
    },
    [applyDesktopSnapshot, clearDesktopSession, pauseInteraction, showNotice, stopLive],
  )

  const approveDesktop = useCallback(
    async (approvalId: string, approve: boolean, via = 'ui') => {
      try {
        const result = await resolveDesktopApproval(approvalId, approve, via)
        setDesktopLastResult(result)
        setDesktopApprovals((prev) => prev.filter((item) => item.approval_id !== approvalId))
        desktopApprovalsRef.current = desktopApprovalsRef.current.filter((item) => item.approval_id !== approvalId)
        showNotice(result.message)
        if (desktopRefreshTimer.current !== null) window.clearTimeout(desktopRefreshTimer.current)
        desktopRefreshTimer.current = window.setTimeout(() => {
          desktopRefreshTimer.current = null
          void refreshDesktopRef.current()
        }, 200)
        return result
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        showNotice(message)
        return null
      }
    },
    [showNotice],
  )

  const approveLatest = useCallback(
    async (approve: boolean, via = 'ui') => {
      const latest = desktopApprovalsRef.current[0]
      if (!latest) {
        showNotice('There is no pending desktop action to approve.')
        return null
      }
      return approveDesktop(latest.approval_id, approve, via)
    },
    [approveDesktop, showNotice],
  )
  useEffect(() => {
    desktopApproveRef.current = approveLatest
  }, [approveLatest])

  useEffect(() => {
    pushToTalkStartRef.current = pushToTalkStart
    pushToTalkEndRef.current = pushToTalkEnd
  }, [pushToTalkStart, pushToTalkEnd])

  const runDesktopAction = useCallback(
    async (actionId: string, params: Record<string, unknown> = {}, source = 'ui') => {
      try {
        const result = await runDesktopActionApi(actionId, params, source)
        noteActionResult(result)
        return result
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        pushToast('error', 'Desktop action failed', message, 7000)
        return null
      }
    },
    [noteActionResult],
  )

  const startDesktopDictation = useCallback(async () => {
    if (!desktopEnabledRef.current) {
      showNotice('Turn Desktop Control on before starting dictation.')
      return null
    }
    return runDesktopAction('dictation.start', {}, 'ui')
  }, [runDesktopAction, showNotice])

  const stopDesktopDictation = useCallback(async () => {
    try {
      const result = await stopDesktopDictationApi()
      noteActionResult(result)
      return result
    } catch (caught) {
      const message = messageOf(caught)
      setDesktopLoadError(message)
      showNotice(message)
      return null
    }
  }, [noteActionResult, showNotice])

  const typeDictation = useCallback(
    async (text: string) => {
      const value = text.trim()
      if (!value) return null
      try {
        const result = await typeDictatedText(value)
        noteActionResult(result)
        return result
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        pushToast('error', 'Dictation was not typed', message, 7000)
        return null
      }
    },
    [noteActionResult],
  )

  const saveDesktopApp = useCallback(
    async (label: string, path: string) => {
      try {
        await addDesktopApp(label, path)
        await refreshDesktopAllowlist()
        showNotice(`Allowlisted app saved: ${label}. Tier 2 — each launch still needs on-screen approval.`)
        return true
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        showNotice(message)
        return false
      }
    },
    [refreshDesktopAllowlist, showNotice],
  )

  const deleteDesktopApp = useCallback(
    async (path: string) => {
      try {
        await removeDesktopApp(path)
        await refreshDesktopAllowlist()
        showNotice('App removed from the allowlist. No file was deleted.')
        return true
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        showNotice(message)
        return false
      }
    },
    [refreshDesktopAllowlist, showNotice],
  )

  const saveDesktopUrl = useCallback(
    async (label: string, url: string) => {
      try {
        await addDesktopUrl(label, url)
        await refreshDesktopAllowlist()
        showNotice(`Allowlisted website saved: ${label}. Tier 2 — each open still needs on-screen approval.`)
        return true
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        showNotice(message)
        return false
      }
    },
    [refreshDesktopAllowlist, showNotice],
  )

  const deleteDesktopUrl = useCallback(
    async (url: string) => {
      try {
        await removeDesktopUrl(url)
        await refreshDesktopAllowlist()
        showNotice('Website removed from the allowlist.')
        return true
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        showNotice(message)
        return false
      }
    },
    [refreshDesktopAllowlist, showNotice],
  )

  const saveDesktopShortcuts = useCallback(
    async (ids: string[]) => {
      try {
        await setDesktopShortcuts(ids)
        await refreshDesktopAllowlist()
        showNotice('Shortcut allowlist updated. Every approved shortcut still needs a confirmation.')
        return true
      } catch (caught) {
        const message = messageOf(caught)
        setDesktopLoadError(message)
        showNotice(message)
        return false
      }
    },
    [refreshDesktopAllowlist, showNotice],
  )

  useEffect(() => {
    if (!desktopStatus?.enabled || desktopStatus.emergency_stopped) return
    if (socketRef.current || desktopEnabledRef.current) return
    void attachDesktopSocket(desktopStatus.token)
  }, [desktopStatus, attachDesktopSocket])

  useEffect(() => {
    const onChange = () => {
      void refreshDesktop()
      void refreshDesktopAllowlist()
    }
    window.addEventListener('bozz:desktop-changed', onChange)
    return () => window.removeEventListener('bozz:desktop-changed', onChange)
  }, [refreshDesktop, refreshDesktopAllowlist])

  useEffect(() => {
    if (!desktopEnabled) return
    const sendPresence = () => {
      // A hidden window in mini mode is still the user actively driving BOZZ.
      socketRef.current?.sendPresence({ hidden: document.hidden && !isMiniModeActive() })
    }
    sendPresence()
    document.addEventListener('visibilitychange', sendPresence)
    window.addEventListener('focus', sendPresence)
    window.addEventListener('blur', sendPresence)
    window.addEventListener(MINI_MODE_EVENT, sendPresence)
    return () => {
      document.removeEventListener('visibilitychange', sendPresence)
      window.removeEventListener('focus', sendPresence)
      window.removeEventListener('blur', sendPresence)
      window.removeEventListener(MINI_MODE_EVENT, sendPresence)
    }
  }, [desktopEnabled])

  useEffect(() => {
    const desktop = settings.desktop
    if (desktopConfigTimer.current !== null) window.clearTimeout(desktopConfigTimer.current)
    desktopConfigTimer.current = window.setTimeout(() => {
      desktopConfigTimer.current = null
      void updateDesktopConfig({
        area: desktop.area,
        position_x: desktop.positionX,
        position_y: desktop.positionY,
        edge_margin: desktop.edgeMargin,
        click_delay_ms: desktop.clickDelayMs,
        idle_seconds: desktop.idleSeconds,
      }).catch((caught: unknown) => {
        if (desktopEnabledRef.current) setDesktopLoadError(messageOf(caught))
      })
    }, 500)
    return () => {
      if (desktopConfigTimer.current !== null) {
        window.clearTimeout(desktopConfigTimer.current)
        desktopConfigTimer.current = null
      }
    }
  }, [settings.desktop])

  const setMicOptIn = useCallback(
    async (value: boolean) => {
      setMicOptInState(value)
      try {
        localStorage.setItem(MIC_OPT_IN_KEY, String(value))
      } catch {
        // best effort
      }
      if (!value) {
        micRef.current?.stop()
        setMicAvailable(false)
        setMicDetail(null)
        return
      }
      const mic = micRef.current ?? new MicLevelGate()
      micRef.current = mic
      const ok = await mic.start()
      setMicAvailable(ok)
      setMicDetail(mic.detail)
      if (!ok) {
        setMicOptInState(false)
        try {
          localStorage.setItem(MIC_OPT_IN_KEY, 'false')
        } catch {
          // best effort
        }
        showNotice(mic.detail ?? 'The microphone could not be started; clap stays low-confidence.')
        return
      }
      showNotice('Microphone gate on for clap confirmation. Loudness only — no audio is stored or sent.')
    },
    [showNotice],
  )

  useEffect(() => {
    if (!orbRef.current) {
      orbRef.current = new OrbMode(settingsRef.current.bindings, {
        onTransform: (rotation, zoom) => applyOrbTransform(rotation, zoom),
      })
    }
    if (!cursorRef.current) {
      cursorRef.current = new CursorMode(settingsRef.current.bindings, {
        onCursor: (x, y) => handleCursorRef.current(x, y),
        onNotice: (message) => showNotice(message),
      })
    }
    return () => {
      orbRef.current?.stop()
      cursorRef.current?.stop()
      desktopRef.current?.stop()
      desktopRef.current = null
    }
  }, [applyOrbTransform, showNotice])

  useEffect(() => {
    // Deferred so the first render is not cascaded by storage/backend reads.
    const timer = window.setTimeout(() => {
      void refreshCustomGestures()
      void refreshDesktop()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshCustomGestures, refreshDesktop])

  useEffect(() => {
    const onAdaptive = (event: Event) => {
      const detail = (event as CustomEvent<AdaptiveSettings>).detail
      adaptiveRef.current = detail ?? loadAdaptiveSettings()
      engineRef.current?.setAdaptive(adaptiveRef.current.gestures)
    }
    window.addEventListener(ADAPTIVE_SETTINGS_EVENT, onAdaptive)
    return () => window.removeEventListener(ADAPTIVE_SETTINGS_EVENT, onAdaptive)
  }, [])

  useEffect(() => {
    if (!enabled) return
    diagnostics.recordGestureSession()
    const tracker = new TapTracker(adaptiveRef.current.gestures.doubleTapWindowMs)
    let lastHeldMs = 0
    const offStart = gestureBus.on('gesture.pinch_start', (payload) => {
      diagnostics.recordGesturePinch(false)
      diagnostics.recordGestureLatency(performance.now() - payload.timestamp)
    })
    const offRejected = gestureBus.on('gesture.rejected', () => diagnostics.recordGestureRejected())
    const offTap = gestureBus.on('gesture.tap', (payload) => {
      const point = mapCameraToViewport(payload.x, payload.y, window.innerWidth, window.innerHeight, true, 0.03)
      const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null
      const target = element
        ? (element.getAttribute('aria-label') || element.id || element.tagName.toLowerCase()).slice(0, 40)
        : 'screen'
      tracker.setWindow(adaptiveRef.current.gestures.doubleTapWindowMs)
      const result = tracker.update({ target, timestamp: payload.timestamp, confidence: payload.confidence })
      if (result.kind === 'double') {
        gestureBus.emit('gesture.double_tap', {
          ...payload,
          target: result.target,
          previousHeldMs: lastHeldMs,
        })
      }
      lastHeldMs = payload.heldMs
    })
    return () => {
      offStart()
      offRejected()
      offTap()
      tracker.reset()
    }
  }, [enabled])


  useEffect(() => {
    orbRef.current?.stop()
    cursorRef.current?.stop()
    desktopRef.current?.stop()
    desktopRef.current = null
    if (!enabled) {
      applyOrbTransform(0, 1)
      return
    }
    if (mode === 'orb') {
      orbRef.current?.start()
      applyOrbTransform(orbRef.current?.current.rotation ?? 0, orbRef.current?.current.zoom ?? 1)
    } else if (mode === 'cursor') {
      cursorRef.current?.start()
    } else if (mode === 'desktop' && desktopEnabled && socketRef.current && desktopConnection === 'connected') {
      const desktop = new DesktopMode(
        socketRef.current,
        settingsRef.current.bindings,
        {
          sensitivity: settingsRef.current.desktop.sensitivity,
          smoothing: settingsRef.current.desktop.smoothing,
          minConfidence: settingsRef.current.minConfidence,
          clickDelayMs: settingsRef.current.desktop.clickDelayMs,
        },
        {
          onApprove: () => {
            void desktopApproveRef.current(true, 'gesture')
          },
          onPushToTalkStart: () => pushToTalkStartRef.current(),
          onPushToTalkEnd: () => pushToTalkEndRef.current(),
          onNotice: (message) => showNotice(message),
        },
      )
      desktopRef.current = desktop
      desktop.start()
    }
    return () => {
      orbRef.current?.stop()
      cursorRef.current?.stop()
      desktopRef.current?.stop()
      desktopRef.current = null
    }
  }, [enabled, mode, desktopEnabled, desktopConnection, applyOrbTransform, showNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (event.key === 'Escape') {
        window.dispatchEvent(new Event('bozz:close-panels'))
        stopVoice()
        return
      }
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault()
        void emergencyStop('Ctrl+Alt+Q pressed.')
        return
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        if (desktopEnabledRef.current) void disableDesktop('Desktop control turned off with Ctrl+Shift+D.')
        else void enableDesktop()
        return
      }
      if (typing) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === 'z') {
        event.preventDefault()
        const label = undoStack.undoLast()
        showNotice(label ? `Undid: ${label}` : 'Nothing to undo yet.')
        return
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (key === 'g') {
        event.preventDefault()
        void toggleEnabled()
      } else if (key === 'm') {
        if (!enabledRef.current) return
        event.preventDefault()
        cycleMode()
      } else if (key === 'r') {
        if (!enabledRef.current) return
        event.preventDefault()
        resetOrb()
      } else if (key === 'p') {
        if (!enabledRef.current) return
        event.preventDefault()
        togglePause()
      } else if (key === 'h') {
        event.preventDefault()
        window.dispatchEvent(new Event('bozz:open-history'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cycleMode, disableDesktop, emergencyStop, enableDesktop, resetOrb, showNotice, stopVoice, toggleEnabled, togglePause])

  useEffect(() => {
    if (!enabled) return
    const pauseBinding = (): string | null => {
      if (modeRef.current === 'desktop') return 'open_palm'
      if (modeRef.current === 'cursor') return settingsRef.current.bindings.cursorPause
      return settingsRef.current.bindings.orbPause
    }
    const attemptToggle = () => {
      const now = performance.now()
      if (now - lastPauseToggle.current < 1200) return
      lastPauseToggle.current = now
      togglePause()
    }
    const unsubscribePalm = gestureBus.on('gesture.palm_pause', () => {
      if (pauseBinding() === 'open_palm') attemptToggle()
    })
    const unsubscribeRecognized = gestureBus.on('gesture.recognized', (payload) => {
      const binding = pauseBinding()
      if (!binding || binding === 'open_palm') return
      if (payload.name === binding && payload.heldMs >= 1000) attemptToggle()
    })
    return () => {
      unsubscribePalm()
      unsubscribeRecognized()
    }
  }, [enabled, togglePause])

  useEffect(() => {
    const onEmergency = () => {
      void emergencyStop()
    }
    window.addEventListener('bozz-emergency-stop', onEmergency)
    return () => window.removeEventListener('bozz-emergency-stop', onEmergency)
  }, [emergencyStop])

  useEffect(() => {
    const onVisibility = () => {
      hiddenSince.current = document.hidden ? performance.now() : 0
    }
    const onBlur = () => {
      if (!document.hidden) hiddenSince.current = performance.now()
    }
    const onFocus = () => {
      hiddenSince.current = 0
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => {
      if (!desktopEnabledRef.current) return
      const now = performance.now()
      if (hiddenSince.current > 0 && now - hiddenSince.current > 10000 && !isMiniModeActive()) {
        void releaseDesktop('Desktop control auto-disabled: this tab was in the background for more than 10 s.')
      }
    }, 500)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [releaseDesktop])

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
      if (recordingTimer.current !== null) window.clearInterval(recordingTimer.current)
      engineRef.current?.stop()
      micRef.current?.stop()
      socketRef.current?.close()
    }
  }, [])

  const desktopState: string =
    desktopConnection === 'stopped'
      ? 'Emergency stopped'
      : desktopEnabled
        ? desktopStatus?.state === 'Paused'
          ? 'Paused'
          : desktopConnection === 'connected'
            ? 'Active'
            : 'Armed'
        : 'Off'

  const value: HgiContextValue = {
    enabled,
    starting,
    mode,
    paused,
    metrics,
    settings,
    calibration,
    calibrationUpdate,
    customGestures,
    notice,
    showNotice,
    error,
    previewEpoch,
    cursorVisible,
    recording,
    recordingFrames,
    replaying,
    micAvailable,
    micDetail,
    micOptIn,
    desktopStatus,
    desktopAllowlist,
    desktopApprovals,
    desktopActions,
    desktopDictation,
    desktopLastResult,
    desktopState,
    desktopPermissionGranted,
    desktopPermissionBusy,
    desktopEnabled,
    desktopBusy,
    desktopConnection,
    desktopDetail,
    desktopLoadError,
    toggleEnabled,
    stopGestures,
    setMode,
    cycleMode,
    resetOrb,
    togglePause,
    updateSettings,
    startCalibration,
    cancelCalibration,
    saveCalibrationProfile,
    clearCalibrationProfile,
    refreshCustomGestures,
    captureSamples,
    subscribePreview,
    subscribeFeatures,
    subscribeRecognition,
    subscribeCursor,
    getVideoElement,
    beginRecording,
    endRecording,
    replaySession,
    refreshDesktop,
    refreshDesktopAllowlist,
    grantDesktopPermission,
    enableDesktop,
    disableDesktop,
    emergencyStop,
    approveDesktop,
    approveLatest,
    runDesktopAction,
    startDesktopDictation,
    stopDesktopDictation,
    typeDictation,
    saveDesktopApp,
    deleteDesktopApp,
    saveDesktopUrl,
    deleteDesktopUrl,
    saveDesktopShortcuts,
    setMicOptIn,
  }

  return <HgiContext.Provider value={value}>{children}</HgiContext.Provider>
}
