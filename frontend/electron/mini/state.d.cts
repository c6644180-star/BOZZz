export type MiniMode = 'full' | 'mini'

export interface ModeState {
  mode: MiniMode
  micListening: boolean
  cameraActive: boolean
}

export type ModeEvent =
  | { type: 'enter-mini' }
  | { type: 'exit-mini' }
  | { type: 'mic'; value: boolean }
  | { type: 'camera'; value: boolean }

export declare const MODES: Set<MiniMode>
export declare function initialState(): ModeState
export declare function reduceMode(state: ModeState, event: ModeEvent | unknown): ModeState
