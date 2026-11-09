import type { GestureTestResult } from '../types'

const KEY = 'bozz.hgi.testResults.v1'

export function loadTestResults(): GestureTestResult[] {
  try {
    const raw = localStorage.getItem(KEY)
    const value = raw ? (JSON.parse(raw) as GestureTestResult[]) : []
    return Array.isArray(value) ? value.filter((item) => Boolean(item && item.id && item.perGesture)) : []
  } catch {
    return []
  }
}

export function saveTestResult(result: GestureTestResult): GestureTestResult[] {
  const next = [result, ...loadTestResults()].slice(0, 20)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}

export function clearTestResults(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
