import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../../../../backend/app/api/files.py', import.meta.url)),
  'utf8',
)

describe('file API stays read-only for hologram content', () => {
  it('never exposes a write, move, rename, delete or upload endpoint for files', () => {
    const blocked = [
      '/files/write',
      '/files/move',
      '/files/rename',
      '/files/delete',
      '/files/upload',
      '/files/copy',
      '/files/trash',
    ]
    for (const route of blocked) {
      expect(source).not.toContain(route)
    }
  })

  it('only allows mutations for roots, search tasks, open approval and layout JSON', () => {
    const mutations = Array.from(source.matchAll(/@router\.(post|put|patch|delete)\("([^"]+)"/g)).map(
      (match) => match[2],
    )
    expect(mutations.sort()).toEqual(
      [
        '/files/find',
        '/files/open',
        '/files/open/{intent_id}/approve',
        '/files/roots',
        '/files/roots',
        '/spatial/layouts',
        '/spatial/layouts/{layout_id}',
        '/spatial/layouts/{layout_id}',
      ].sort(),
    )
  })

  it('serves models and raw sidecars through GET only', () => {
    expect(source).toContain('@router.get("/files/model")')
    expect(source).toContain('@router.get("/files/raw")')
  })
})
