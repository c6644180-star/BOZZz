import { describe, expect, it } from 'vitest'
import { dirname, findSidecars, isHoloModel, modelUrl, rawUrl, resolveModelUri } from '../modelSource'

describe('modelSource', () => {
  it('recognises only GLB and glTF files as hologram models', () => {
    expect(isHoloModel('C:\\lab\\scene.glb')).toBe(true)
    expect(isHoloModel('C:\\lab\\scene.GLTF')).toBe(true)
    expect(isHoloModel('C:\\lab\\scene.obj')).toBe(false)
    expect(isHoloModel('C:\\lab\\notes.glb.txt')).toBe(false)
  })

  it('builds read-only endpoint URLs with an encoded path', () => {
    const path = 'C:\\lab\\my scene.glb'
    expect(modelUrl(path)).toBe(`/api/files/model?path=${encodeURIComponent(path)}`)
    expect(rawUrl(path)).toBe(`/api/files/raw?path=${encodeURIComponent(path)}`)
  })

  it('finds the containing folder on Windows and POSIX paths', () => {
    expect(dirname('C:\\lab\\models\\scene.gltf')).toBe('C:\\lab\\models')
    expect(dirname('/home/bozz/models/scene.gltf')).toBe('/home/bozz/models')
  })

  it('resolves relative sidecars inside the model folder', () => {
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', 'textures/wood.png')).toBe(
      'C:\\lab\\models\\textures\\wood.png',
    )
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', './textures/../wood.png')).toBe(
      'C:\\lab\\models\\wood.png',
    )
    expect(resolveModelUri('/home/bozz/models/scene.gltf', 'textures/wood.png')).toBe(
      '/home/bozz/models/textures/wood.png',
    )
  })

  it('never climbs above the model folder', () => {
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', '../outside.bin')).toBeNull()
    expect(resolveModelUri('/home/bozz/models/scene.gltf', '../../etc/passwd')).toBeNull()
  })

  it('keeps absolute drive paths and ignores remote or data URIs', () => {
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', 'D:\\shared\\wood.png')).toBe('D:\\shared\\wood.png')
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', 'data:application/octet-stream;base64,AAAA')).toBeNull()
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', 'https://example.com/a.bin')).toBeNull()
    expect(resolveModelUri('C:\\lab\\models\\scene.gltf', '   ')).toBeNull()
  })

  it('collects only real sidecars from a glTF document', () => {
    const sidecars = findSidecars(
      {
        buffers: [{ uri: 'buffer.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
        images: [{ uri: 'textures/a.png' }, {}],
      },
      'C:\\lab\\models\\scene.gltf',
    )
    expect(sidecars.buffers).toEqual([
      { uri: 'buffer.bin', resolved: 'C:\\lab\\models\\buffer.bin' },
    ])
    expect(sidecars.images).toEqual([
      { uri: 'textures/a.png', resolved: 'C:\\lab\\models\\textures\\a.png' },
    ])
  })
})
