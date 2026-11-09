import { describe, expect, it } from 'vitest'
import { GestureStabilizer } from '../gestureStability'
import { TapTracker } from '../tapTracker'
import { percentile, proposeTuning } from '../tuning'

describe('gesture stability', () => {
  it('requires consecutive stable frames', () => {
    const stabilizer = new GestureStabilizer({ requiredFrames: 3, minScore: 0.5, maxJump: 0.2, edgeMargin: 0.03 })
    expect(stabilizer.update({ x: 0.5, y: 0.5, score: 0.9, timestamp: 0 }).stable).toBe(false)
    expect(stabilizer.update({ x: 0.501, y: 0.5, score: 0.9, timestamp: 33 }).stable).toBe(false)
    const third = stabilizer.update({ x: 0.502, y: 0.5, score: 0.9, timestamp: 66 })
    expect(third.stable).toBe(true)
    expect(third.consecutive).toBe(3)
  })

  it('rejects teleports, frame edges and low confidence', () => {
    const stabilizer = new GestureStabilizer({ requiredFrames: 2, minScore: 0.5, maxJump: 0.1, edgeMargin: 0.05 })
    stabilizer.update({ x: 0.5, y: 0.5, score: 0.9, timestamp: 0 })
    const jump = stabilizer.update({ x: 0.9, y: 0.5, score: 0.9, timestamp: 30 })
    expect(jump.stable).toBe(false)
    expect(jump.reasons.join(' ')).toMatch(/teleport/i)
    const edge = stabilizer.update({ x: 0.01, y: 0.5, score: 0.9, timestamp: 60 })
    expect(edge.edge).toBe(true)
    expect(edge.stable).toBe(false)
    const weak = stabilizer.update({ x: 0.4, y: 0.4, score: 0.2, timestamp: 90 })
    expect(weak.stable).toBe(false)
    expect(weak.confidence.value).toBe(0)
  })
})

describe('tap tracker', () => {
  it('detects two taps on the same target inside the window', () => {
    const tracker = new TapTracker(300)
    const first = tracker.update({ target: 'card-1', timestamp: 1000, confidence: 0.8 })
    expect(first.kind).toBe('single')
    const second = tracker.update({ target: 'card-1', timestamp: 1250, confidence: 0.9 })
    expect(second.kind).toBe('double')
    expect(second.intervalMs).toBe(250)
    expect(second.confidence).toBe(0.8)
  })

  it('does not pair taps on different targets or after the window', () => {
    const tracker = new TapTracker(300)
    tracker.update({ target: 'a', timestamp: 0, confidence: 0.9 })
    expect(tracker.update({ target: 'b', timestamp: 100, confidence: 0.9 }).kind).toBe('single')
    tracker.update({ target: 'b', timestamp: 200, confidence: 0.9 })
    expect(tracker.update({ target: 'b', timestamp: 900, confidence: 0.9 }).kind).toBe('single')
  })
})

describe('gesture tuning', () => {
  it('proposes thresholds only from separated real samples', () => {
    const proposal = proposeTuning(
      {
        pinched: [0.17, 0.18, 0.2, 0.21, 0.22, 0.24],
        open: [0.5, 0.55, 0.6, 0.62, 0.66, 0.7],
        tapDurationsMs: [90, 120, 150, 180, 210],
        holdDurationsMs: [420, 500, 600],
      },
      { pinchOn: 0.3, pinchOff: 0.48, tapMaxMs: 260, holdMs: 120 },
      123,
    )
    expect(proposal.usable).toBe(true)
    expect(proposal.pinchOn).toBeLessThan(proposal.pinchOff)
    expect(proposal.pinchOn).toBeGreaterThan(0.22)
    expect(proposal.tapMaxMs).toBe(290)
    expect(proposal.holdMs).toBe(400)
    expect(proposal.reasons.length).toBeGreaterThan(0)
  })

  it('refuses to propose anything without enough samples', () => {
    const proposal = proposeTuning(
      { pinched: [0.2], open: [], tapDurationsMs: [], holdDurationsMs: [] },
      { pinchOn: 0.3, pinchOff: 0.48, tapMaxMs: 260, holdMs: 120 },
    )
    expect(proposal.usable).toBe(false)
    expect(proposal.pinchOn).toBe(0.3)
  })

  it('keeps hysteresis when samples overlap', () => {
    const proposal = proposeTuning(
      {
        pinched: [0.3, 0.32, 0.34, 0.36, 0.38, 0.4],
        open: [0.41, 0.42, 0.43, 0.44, 0.45, 0.46],
        tapDurationsMs: [],
        holdDurationsMs: [],
      },
      { pinchOn: 0.3, pinchOff: 0.48, tapMaxMs: 260, holdMs: 120 },
    )
    expect(proposal.usable).toBe(true)
    expect(proposal.pinchOff - proposal.pinchOn).toBeGreaterThanOrEqual(0.12)
  })

  it('computes percentiles safely', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(3)
  })
})
