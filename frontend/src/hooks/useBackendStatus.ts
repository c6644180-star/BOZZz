import { useEffect, useState } from 'react'
import { probeBackend } from '../services/backend'
import { pushNotification } from '../services/localStore'
import type { ConnStatus } from '../types/bozz'

export function useBackendStatus(pollMs = 20000): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>('checking')
  useEffect(() => {
    let disposed = false
    const check = async () => {
      const next = await probeBackend()
      if (disposed) return
      setStatus((prev) => {
        if (prev !== 'checking' && prev !== next) {
          pushNotification(next === 'online' ? 'BOZZ backend came online.' : 'BOZZ backend is unreachable.')
        }
        return next
      })
    }
    void check()
    const timer = window.setInterval(() => void check(), pollMs)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [pollMs])
  return status
}
