import { FEATURE_VECTOR_SIZE } from '../types'
import type { TaughtGesture } from '../types'

const DB_NAME = 'bozz-hgi'
const DB_VERSION = 1
const STORE = 'gestures'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser, so taught gestures cannot be stored.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the local gesture database.'))
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local gesture database request failed.'))
  })
}

function isValidGesture(value: unknown): value is TaughtGesture {
  if (!value || typeof value !== 'object') return false
  const gesture = value as TaughtGesture
  if (typeof gesture.name !== 'string' || !gesture.name.trim()) return false
  if (!Array.isArray(gesture.samples) || gesture.samples.length < 5 || gesture.samples.length > 500) return false
  return gesture.samples.every(
    (sample) =>
      Array.isArray(sample) &&
      sample.length === FEATURE_VECTOR_SIZE &&
      sample.every((number) => Number.isFinite(number)),
  )
}

export async function listTaughtGestures(): Promise<TaughtGesture[]> {
  const db = await openDb()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const gestures = await requestResult(store.getAll() as IDBRequest<TaughtGesture[]>)
  return gestures.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveTaughtGesture(gesture: TaughtGesture): Promise<void> {
  if (!isValidGesture(gesture)) throw new Error('That gesture sample set is not valid.')
  const db = await openDb()
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
  await requestResult(store.put(gesture))
}

export async function deleteTaughtGesture(name: string): Promise<void> {
  const db = await openDb()
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
  await requestResult(store.delete(name))
}

export async function renameTaughtGesture(oldName: string, nextName: string): Promise<TaughtGesture> {
  const name = nextName.trim()
  if (!name || name.length > 32) throw new Error('Choose a name between 1 and 32 characters.')
  const db = await openDb()
  const readStore = db.transaction(STORE, 'readonly').objectStore(STORE)
  const existing = await requestResult(readStore.get(oldName) as IDBRequest<TaughtGesture | undefined>)
  if (!existing) throw new Error('That taught gesture no longer exists.')
  const renamed: TaughtGesture = { ...existing, name }
  const writeStore = db.transaction(STORE, 'readwrite').objectStore(STORE)
  await requestResult(writeStore.put(renamed))
  if (name !== oldName) {
    const deleteStore = db.transaction(STORE, 'readwrite').objectStore(STORE)
    await requestResult(deleteStore.delete(oldName))
  }
  return renamed
}

export async function exportTaughtGestures(): Promise<string> {
  const gestures = await listTaughtGestures()
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), gestures }, null, 2)
}

export async function importTaughtGestures(json: string): Promise<number> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const values =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { gestures?: unknown }).gestures)
      ? ((parsed as { gestures: unknown[] }).gestures)
      : Array.isArray(parsed)
        ? parsed
        : null
  if (!values) throw new Error('Expected a gestures array in the exported file.')
  const valid = values.filter(isValidGesture)
  if (valid.length === 0) throw new Error('No valid taught gestures were found in that file.')
  for (const gesture of valid) {
    await saveTaughtGesture({ ...gesture, name: gesture.name.trim() })
  }
  return valid.length
}
