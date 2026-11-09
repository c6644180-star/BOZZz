import { useEffect, useState } from 'react'
import type { ConnStatus } from '../../types/bozz'

interface HeapMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
}

function browserHeap(): HeapMemory | null {
  const perf = performance as Performance & { memory?: HeapMemory }
  return perf.memory && perf.memory.totalJSHeapSize > 0 ? perf.memory : null
}

export function SystemStatusPanel({ status }: { status: ConnStatus }) {
  const [heap, setHeap] = useState<HeapMemory | null>(() => browserHeap())
  useEffect(() => {
    const timer = window.setInterval(() => setHeap(browserHeap()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const ramPct = heap ? Math.round((heap.usedJSHeapSize / heap.totalJSHeapSize) * 100) : null
  const online = status === 'online'
  const headline = online ? 'Local API reachable' : status === 'checking' ? 'Checking backend…' : 'Backend not connected'

  return (
    <section className="edge-panel status-panel">
      <div className="panel-title">
        <span><i className={`dot-${status}`} /> System Status</span>
        <b className={online ? 'is-ok' : 'is-warn'}>{headline}</b>
      </div>
      <div className="gauges">
        <div className="gauge gauge-0">
          <div><strong>--</strong></div>
          <span>CPU</span>
          <small>Not exposed by browser</small>
        </div>
        <div className="gauge gauge-1">
          <div><strong>{ramPct !== null ? `${ramPct}%` : '--'}</strong></div>
          <span>RAM</span>
          <small>{ramPct !== null ? 'JS heap only' : 'Not exposed by browser'}</small>
        </div>
        <div className="gauge gauge-2">
          <div><strong>--</strong></div>
          <span>Temp</span>
          <small>No sensor connected</small>
        </div>
      </div>
    </section>
  )
}
