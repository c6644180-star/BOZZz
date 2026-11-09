import { useCallback, useEffect, useRef, useState } from 'react'
import {
  changeModulePermission,
  fetchModules,
  frontendSnapshot,
  onModulesChanged,
} from '../services/modules'
import type { ModulesSnapshot, PermissionId } from '../types/modules'

export function useModules() {
  const [snapshot, setSnapshot] = useState<ModulesSnapshot>(() => frontendSnapshot())
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchModules(signal)
      if (!mounted.current) return
      setSnapshot(next)
      setOffline(false)
      setError(null)
    } catch (caught) {
      if (signal?.aborted) return
      if (!mounted.current) return
      setOffline(true)
      setSnapshot(frontendSnapshot())
      setError(caught instanceof Error ? caught.message : 'The module registry is unavailable.')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    // Fetching on mount and on registry events is the intended subscription pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(controller.signal)
    const stop = onModulesChanged(() => void refresh())
    return () => {
      mounted.current = false
      controller.abort()
      stop()
    }
  }, [refresh])

  const setPermission = useCallback(
    async (moduleId: string, permissionId: PermissionId, granted: boolean): Promise<boolean> => {
      const key = `${moduleId}:${permissionId}`
      setBusy(key)
      setError(null)
      try {
        const updated = await changeModulePermission(moduleId, permissionId, granted)
        if (!mounted.current) return true
        setSnapshot((current) => ({
          ...current,
          modules: current.modules.map((module) => (module.id === updated.id ? updated : module)),
        }))
        return true
      } catch (caught) {
        if (mounted.current) {
          setError(caught instanceof Error ? caught.message : 'The permission change failed.')
        }
        return false
      } finally {
        if (mounted.current) setBusy(null)
      }
    },
    [],
  )

  return { snapshot, loading, offline, error, busy, refresh, setPermission }
}
