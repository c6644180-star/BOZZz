import { createContext, useContext } from 'react'
import type { RecognitionFrame } from '../../hgi/engine/GestureEngine'
import type { CalibrationUpdate } from '../../hgi/calibration/calibrator'
import type {
  DesktopActionRecord,
  DesktopActionResult,
  DesktopAllowlist,
  DesktopConnection,
  DesktopStatus,
  DictationState,
  PendingApproval,
} from '../../hgi/desktop/desktopSocket'
import type {
  CalibrationProfile,
  FeatureFrame,
  HandLandmarks,
  HgiMetrics,
  HgiMode,
  HgiSettings,
  RecordedSession,
  ReplayResult,
  TaughtGesture,
} from '../../hgi/types'

export type CursorListener = (x: number, y: number) => void
export type PreviewListener = (hands: HandLandmarks[], timestamp: number) => void
export type FeatureListener = (frame: FeatureFrame) => void
export type RecognitionListener = (frame: RecognitionFrame) => void

export interface HgiContextValue {
  enabled: boolean
  starting: boolean
  mode: HgiMode
  paused: boolean
  metrics: HgiMetrics
  settings: HgiSettings
  calibration: CalibrationProfile | null
  calibrationUpdate: CalibrationUpdate | null
  customGestures: TaughtGesture[]
  notice: string | null
  showNotice: (message: string | null) => void
  error: string | null
  previewEpoch: number
  cursorVisible: boolean
  recording: boolean
  recordingFrames: number
  replaying: boolean
  micAvailable: boolean
  micDetail: string | null
  micOptIn: boolean
  desktopStatus: DesktopStatus | null
  desktopAllowlist: DesktopAllowlist | null
  desktopApprovals: PendingApproval[]
  desktopActions: DesktopActionRecord[]
  desktopDictation: DictationState | null
  desktopLastResult: DesktopActionResult | null
  desktopState: string
  desktopPermissionGranted: boolean
  desktopPermissionBusy: boolean
  desktopEnabled: boolean
  desktopBusy: boolean
  desktopConnection: DesktopConnection
  desktopDetail: string | null
  desktopLoadError: string | null
  toggleEnabled: () => Promise<void>
  stopGestures: (reason?: string) => void
  setMode: (mode: HgiMode) => void
  cycleMode: () => void
  resetOrb: () => void
  togglePause: () => void
  updateSettings: (patch: Partial<HgiSettings>) => void
  startCalibration: () => void
  cancelCalibration: () => void
  saveCalibrationProfile: (profile: CalibrationProfile) => void
  clearCalibrationProfile: () => void
  refreshCustomGestures: () => Promise<void>
  captureSamples: (durationMs?: number, target?: number) => Promise<number[][]>
  subscribePreview: (listener: PreviewListener) => () => void
  subscribeFeatures: (listener: FeatureListener) => () => void
  subscribeRecognition: (listener: RecognitionListener) => () => void
  subscribeCursor: (listener: CursorListener) => () => void
  getVideoElement: () => HTMLVideoElement | null
  beginRecording: () => void
  endRecording: () => RecordedSession | null
  replaySession: (session: RecordedSession, speed?: number) => Promise<ReplayResult>
  refreshDesktop: () => Promise<void>
  refreshDesktopAllowlist: () => Promise<void>
  grantDesktopPermission: () => Promise<boolean>
  enableDesktop: () => Promise<void>
  disableDesktop: (reason?: string) => Promise<void>
  emergencyStop: (reason?: string) => Promise<void>
  approveDesktop: (approvalId: string, approve: boolean, via?: string) => Promise<DesktopActionResult | null>
  approveLatest: (approve: boolean, via?: string) => Promise<DesktopActionResult | null>
  runDesktopAction: (actionId: string, params?: Record<string, unknown>, source?: string) => Promise<DesktopActionResult | null>
  startDesktopDictation: () => Promise<DesktopActionResult | null>
  stopDesktopDictation: () => Promise<DesktopActionResult | null>
  typeDictation: (text: string) => Promise<DesktopActionResult | null>
  saveDesktopApp: (label: string, path: string) => Promise<boolean>
  deleteDesktopApp: (path: string) => Promise<boolean>
  saveDesktopUrl: (label: string, url: string) => Promise<boolean>
  deleteDesktopUrl: (url: string) => Promise<boolean>
  saveDesktopShortcuts: (ids: string[]) => Promise<boolean>
  setMicOptIn: (value: boolean) => Promise<void>
}

export const HgiContext = createContext<HgiContextValue | null>(null)

export function useHgi(): HgiContextValue {
  const context = useContext(HgiContext)
  if (!context) throw new Error('useHgi must be used inside HgiProvider.')
  return context
}
