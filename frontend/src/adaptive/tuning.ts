export interface TuningSamples {
  pinched: number[]
  open: number[]
  tapDurationsMs: number[]
  holdDurationsMs: number[]
}

export interface TuningProposal {
  usable: boolean
  pinchOn: number
  pinchOff: number
  tapMaxMs: number
  holdMs: number
  samples: { pinched: number; open: number; taps: number; holds: number }
  reasons: string[]
  createdAt: number
}

function sorted(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b)
}

export function percentile(values: number[], ratio: number): number | null {
  const list = sorted(values)
  if (list.length === 0) return null
  const index = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * ratio)))
  return list[index]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// Proposes new pinch thresholds from real measurements. It never writes
// settings — the caller shows the proposal and the user accepts or edits it.
export function proposeTuning(
  samples: TuningSamples,
  current: { pinchOn: number; pinchOff: number; tapMaxMs: number; holdMs: number },
  now = Date.now(),
): TuningProposal {
  const pinched = sorted(samples.pinched)
  const open = sorted(samples.open)
  const taps = sorted(samples.tapDurationsMs)
  const holds = sorted(samples.holdDurationsMs)
  const reasons: string[] = []

  if (pinched.length < 5 || open.length < 5) {
    return {
      usable: false,
      pinchOn: current.pinchOn,
      pinchOff: current.pinchOff,
      tapMaxMs: current.tapMaxMs,
      holdMs: current.holdMs,
      samples: { pinched: pinched.length, open: open.length, taps: taps.length, holds: holds.length },
      reasons: ['Not enough pinch samples yet (5 pinched and 5 open frames are required).'],
      createdAt: now,
    }
  }

  const pinchedHigh = pinched[Math.floor(pinched.length * 0.9)] ?? pinched[pinched.length - 1]
  const openLow = open[Math.max(0, Math.floor(open.length * 0.1))] ?? open[0]
  const separated = openLow - pinchedHigh > 0.04
  let pinchOn: number
  let pinchOff: number
  if (separated) {
    pinchOn = pinchedHigh + (openLow - pinchedHigh) * 0.25
    pinchOff = pinchedHigh + (openLow - pinchedHigh) * 0.65
    reasons.push(
      `Pinched frames end at ${round2(pinchedHigh)}; open frames start at ${round2(openLow)}.`,
      `Pinch-on set 25% into the gap and pinch-off 65% into it for hysteresis.`,
    )
  } else {
    pinchOn = Math.min(current.pinchOn, pinchedHigh)
    pinchOff = Math.max(current.pinchOff, pinchOn + 0.12)
    reasons.push(
      `Pinched and open samples overlap (${round2(pinchedHigh)} vs ${round2(openLow)}); keeping the wider current hysteresis.`,
    )
  }

  const tapP90 = percentile(taps, 0.9)
  const tapMaxMs = tapP90 === null
    ? current.tapMaxMs
    : Math.round(Math.min(400, Math.max(150, tapP90 + 80)))
  if (tapP90 !== null) reasons.push(`90% of taps finished within ${Math.round(tapP90)} ms; window set to ${tapMaxMs} ms.`)

  const holdP25 = percentile(holds, 0.25)
  const holdMs = holdP25 !== null
    ? Math.round(Math.min(400, Math.max(100, holdP25 - 40)))
    : Math.max(100, Math.min(300, tapMaxMs + 60))
  if (holdP25 !== null) reasons.push(`Shortest deliberate holds started at ${Math.round(holdP25)} ms; hold minimum set to ${holdMs} ms.`)

  return {
    usable: true,
    pinchOn: round2(Math.min(0.5, Math.max(0.08, pinchOn))),
    pinchOff: round2(Math.min(0.9, Math.max(0.12, pinchOff))),
    tapMaxMs,
    holdMs,
    samples: { pinched: pinched.length, open: open.length, taps: taps.length, holds: holds.length },
    reasons,
    createdAt: now,
  }
}
