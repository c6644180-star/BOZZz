'use strict'

/**
 * Reasons that stop the mini orb from moving or animating. Kept pure so the
 * rules are testable; Electron's powerMonitor and screen APIs feed the inputs.
 */

const IDLE_LIMIT_SECONDS = 180

function computePauseReasons(input) {
  const source = input && typeof input === 'object' ? input : {}
  const reasons = []
  const wanderEnabled = source.wanderEnabled !== false
  const busy = source.busy === true
  const idleSeconds = Number.isFinite(source.idleSeconds) ? source.idleSeconds : 0
  const idleLimit = Number.isFinite(source.idleLimitSeconds)
    ? Math.max(1, source.idleLimitSeconds)
    : IDLE_LIMIT_SECONDS

  if (!wanderEnabled) reasons.push('wander-off')
  if (source.manualPause === true) reasons.push('manual-pause')
  if (source.approvalPending === true) reasons.push('approval')
  if (source.fullscreen === true) reasons.push('fullscreen')
  if (source.pauseOnBattery !== false && source.onBattery === true) reasons.push('battery')
  // Audio or microphone activity is real user interaction, so system idle time
  // alone must not freeze the speaking/listening orb animation.
  if (!busy && idleSeconds >= idleLimit) reasons.push('idle')
  return reasons
}

function shouldPauseAnimation(reasons) {
  const list = Array.isArray(reasons) ? reasons : []
  return list.includes('idle') || list.includes('battery') || list.includes('fullscreen')
}

function shouldPauseWander(reasons) {
  return Array.isArray(reasons) && reasons.length > 0
}

module.exports = { IDLE_LIMIT_SECONDS, computePauseReasons, shouldPauseAnimation, shouldPauseWander }
