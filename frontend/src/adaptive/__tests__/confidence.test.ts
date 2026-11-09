import { describe, expect, it } from 'vitest'
import {
  clarifyAndDecide,
  classifyAction,
  combineConfidence,
  evaluateConfidence,
  isNo,
  isUndoPhrase,
  isYes,
  makeConfidence,
  parseLabelPhrase,
} from '../confidence'

describe('adaptive confidence', () => {
  it('classifies blocked, consequential and safe actions', () => {
    expect(classifyAction('shut down the computer')).toBe('blocked')
    expect(classifyAction('delete that file')).toBe('blocked')
    expect(classifyAction('open notepad')).toBe('consequential')
    expect(classifyAction('explode the model')).toBe('safe')
  })

  it('never executes a blocked action, whatever the confidence', () => {
    const decision = evaluateConfidence(makeConfidence(1, 'speech', ['perfect audio']), 'blocked', {
      safe: 0.6,
      consequential: 0.85,
    })
    expect(decision.decision).toBe('block')
    expect(decision.fallback).toMatch(/blocked/i)
  })

  it('rejects a safe action below the safe threshold', () => {
    const decision = evaluateConfidence(makeConfidence(0.4, 'speech', []), 'safe', { safe: 0.6, consequential: 0.85 })
    expect(decision.decision).toBe('reject')
    expect(decision.reason).toContain('60%')
  })

  it('confirms a consequential action that clears the high threshold', () => {
    const decision = evaluateConfidence(makeConfidence(0.9, 'speech', []), 'consequential', {
      safe: 0.6,
      consequential: 0.85,
    })
    expect(decision.decision).toBe('confirm')
  })

  it('rejects a consequential action below the high threshold even when above safe', () => {
    const decision = evaluateConfidence(makeConfidence(0.75, 'speech', []), 'consequential', {
      safe: 0.6,
      consequential: 0.85,
    })
    expect(decision.decision).toBe('reject')
  })

  it('does not let one strong signal hide a weak one', () => {
    const combined = combineConfidence([
      { value: 1, weight: 1, reason: 'landmark confidence' },
      { value: 0.1, weight: 1, reason: 'stability' },
    ])
    expect(combined.value).toBeLessThan(0.4)
    expect(combined.reasons).toHaveLength(2)
  })

  it('asks for clarification exactly at the boundary', () => {
    const decision = clarifyAndDecide(makeConfidence(0.5, 'speech', []), 'safe', { safe: 0.62, consequential: 0.85 })
    expect(decision?.decision).toBe('reject')
    expect(clarifyAndDecide(makeConfidence(0.8, 'speech', []), 'safe', { safe: 0.62, consequential: 0.85 })).toBeNull()
  })

  it('understands yes/no/undo and label phrases', () => {
    expect(isYes('yes')).toBe(true)
    expect(isNo('no')).toBe(true)
    expect(isUndoPhrase('undo')).toBe(true)
    expect(isUndoPhrase('undo that')).toBe(true)
    expect(parseLabelPhrase('this is the front-left wheel')).toBe('front-left wheel')
    expect(parseLabelPhrase('rename this')).toBeNull()
  })
})
