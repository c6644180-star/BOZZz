import { describe, expect, it } from 'vitest'
import { GestureClassifier } from '../classification/classifier'
import type { HandFeatures, TaughtGesture } from '../types'

function makeFeatures(vector: number[], overrides: Partial<HandFeatures> = {}): HandFeatures {
  return {
    hand: 'Right',
    extension: vector.slice(0, 5),
    pinchRatio: vector[5] * 1.5,
    openness: vector[6],
    palmFacing: 0.5,
    palmRoll: 0,
    rollRate: 0,
    speed: vector[10] * 2,
    handSize: 0.09,
    indexTip: { x: 0.5, y: 0.5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    palmCenter: { x: 0.5, y: 0.5, z: 0 },
    worldCenter: { x: 0, y: 0, z: 0 },
    twoFinger: vector[7] > 0.5,
    claw: vector[8] > 0.5,
    score: 0.95,
    vector,
    ...overrides,
  }
}

const ctx = {
  hands: 1,
  twoHandDistance: null,
  twoHandClosing: 0,
  micSpike: false,
  otherHand: null,
  minConfidence: 0.62,
}

describe('GestureClassifier', () => {
  it('recognises a pinch centroid with high confidence', () => {
    const classifier = new GestureClassifier()
    const result = classifier.classify(
      makeFeatures([0.6, 0.6, 0.15, 0.15, 0.15, 0.08, 0.42, 0, 0, 0, 0.1, 0]),
      ctx,
    )
    expect(result.name).toBe('pinch')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('recognises a point pose', () => {
    const classifier = new GestureClassifier()
    const result = classifier.classify(
      makeFeatures([0.2, 0.95, 0.1, 0.1, 0.1, 0.8, 0.35, 0, 0, 1, 0.05, 0]),
      ctx,
    )
    expect(result.name).toBe('point')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('reports two-hand pinch when both hands are pinched', () => {
    const classifier = new GestureClassifier()
    const hand = makeFeatures([0.6, 0.6, 0.15, 0.15, 0.15, 0.13, 0.42, 0, 0, 0, 0.1, 0], { pinchRatio: 0.2 })
    const other = makeFeatures([0.6, 0.6, 0.15, 0.15, 0.15, 0.1, 0.42, 0, 0, 0, 0.1, 0], {
      hand: 'Left',
      pinchRatio: 0.15,
    })
    const result = classifier.classify(hand, { ...ctx, hands: 2, otherHand: other, twoHandDistance: 1.2 })
    expect(result.name).toBe('two_hand_pinch')
    expect(result.confidence).toBeGreaterThan(0.7)
  })

  it('keeps clap low-confidence unless the microphone confirms it', () => {
    const classifier = new GestureClassifier()
    const hand = makeFeatures([0.9, 0.9, 0.9, 0.9, 0.9, 0.7, 0.85, 0, 0, 0, 0.1, 0])
    const other = makeFeatures([0.9, 0.9, 0.9, 0.9, 0.9, 0.7, 0.85, 0, 0, 0, 0.1, 0], { hand: 'Left' })
    const quiet = classifier.classify(hand, {
      ...ctx,
      hands: 2,
      otherHand: other,
      twoHandDistance: 0.8,
      twoHandClosing: 1.2,
    })
    expect(quiet.name).not.toBe('clap')
    const loud = classifier.classify(hand, {
      ...ctx,
      hands: 2,
      otherHand: other,
      twoHandDistance: 0.8,
      twoHandClosing: 1.2,
      micSpike: true,
    })
    expect(loud.name).toBe('clap')
    expect(loud.confidence).toBeGreaterThan(0.8)
  })

  it('prefers a taught gesture when its samples are closer', () => {
    const classifier = new GestureClassifier()
    const vector = [0.33, 0.66, 0.22, 0.77, 0.44, 0.3, 0.6, 0.2, 0.2, 0.2, 0.2, 0.2]
    const taught: TaughtGesture = {
      name: 'drum',
      createdAt: Date.now(),
      samples: Array.from({ length: 6 }, () => [...vector]),
    }
    classifier.setCustomGestures([taught])
    const result = classifier.classify(makeFeatures(vector), ctx)
    expect(result.name).toBe('custom:drum')
    expect(result.confidence).toBeGreaterThan(0.9)
  })
})
