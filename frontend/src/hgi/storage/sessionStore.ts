import type { RecordedSession } from '../types'

export interface StoredSession extends RecordedSession {
  id: string
  label: string
}

const DB_NAME = 'bozz-hgi-sessions'
const DB_VERSION = 1
const STORE = 'sessions'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available, so sessions cannot be stored.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the local session database.'))
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local session request failed.'))
  })
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false
  const session = value as StoredSession
  return (
    typeof session.id === 'string' &&
    typeof session.label === 'string' &&
    session.version === 1 &&
    Array.isArray(session.frames)
  )
}

export async function saveSession(session: RecordedSession, label: string): Promise<StoredSession> {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  const stored: StoredSession = { ...session, id, label: label.trim() || new Date(session.createdAt).toLocaleString() }
  const db = await openDb()
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
  await requestResult(store.put(stored))
  return stored
}

export async function listSessions(): Promise<StoredSession[]> {
  const db = await openDb()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const values = await requestResult(store.getAll() as IDBRequest<unknown[]>)
  return values.filter(isStoredSession).sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDb()
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
  await requestResult(store.delete(id))
}

export function sessionDuration(session: RecordedSession): number {
  if (session.frames.length < 2) return 0
  return Math.max(0, Math.round(session.frames[session.frames.length - 1].timestamp - session.frames[0].timestamp))
}
