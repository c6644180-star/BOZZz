import type { BuiltinGesture, GestureName } from '../types'

// Feature vector order (see FEATURE_VECTOR_SIZE):
// 0-4 finger extension (thumb, index, middle, ring, pinky)
// 5 pinch distance / hand size (clamped)
// 6 openness
// 7 two-finger pose flag
// 8 claw flag
// 9 point-pose flag
// 10 fingertip speed score
// 11 wrist rotation score
//
// These are starting centroids from hand geometry, not recorded user data.
// Calibration replaces open palm, pinch and fist with the user's own samples.
export const BUILTIN_CENTROIDS: Record<Exclude<BuiltinGesture, 'two_hand_pinch' | 'clap'>, number[]> = {
  point: [0.2, 0.95, 0.1, 0.1, 0.1, 0.8, 0.35, 0, 0, 1, 0.05, 0],
  pinch: [0.6, 0.6, 0.15, 0.15, 0.15, 0.08, 0.42, 0, 0, 0, 0.1, 0],
  open_palm: [0.95, 0.95, 0.95, 0.95, 0.95, 1.1, 0.95, 0, 0, 0, 0.05, 0],
  fist: [0.1, 0.08, 0.08, 0.08, 0.08, 0.65, 0.08, 0, 0, 0, 0.05, 0],
  two_finger_scroll: [0.4, 0.95, 0.95, 0.1, 0.1, 0.9, 0.45, 1, 0, 0, 0.5, 0],
  claw: [0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.45, 0, 1, 0, 0.15, 0],
  wrist_rotation: [0.7, 0.7, 0.7, 0.7, 0.7, 0.9, 0.6, 0, 0, 0, 0.2, 1],
  flick: [0.4, 0.8, 0.4, 0.2, 0.2, 0.8, 0.4, 0, 0, 0.5, 1, 0],
  thumbs_up: [0.95, 0.08, 0.08, 0.08, 0.08, 0.95, 0.22, 0, 0, 0, 0.05, 0],
}

export const GESTURE_LABELS: Record<BuiltinGesture, string> = {
  point: 'Point',
  pinch: 'Pinch',
  two_hand_pinch: 'Two-hand pinch',
  open_palm: 'Open palm',
  fist: 'Fist',
  two_finger_scroll: 'Two-finger scroll',
  wrist_rotation: 'Wrist rotation',
  flick: 'Flick',
  claw: 'Claw',
  clap: 'Clap',
  thumbs_up: 'Thumbs up',
}

export function gestureLabel(name: GestureName | null): string {
  if (!name) return 'No gesture'
  if (name.startsWith('custom:')) return name.slice('custom:'.length)
  return GESTURE_LABELS[name as BuiltinGesture] ?? name
}
