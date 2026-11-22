import { describe, expect, it, vi } from 'vitest'
import { MediaPipeSource } from '../landmarks/MediaPipeSource'

describe('MediaPipeSource camera lifecycle', () => {
  it('reports a denied camera permission without pretending tracking started', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    )
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const source = new MediaPipeSource('low')

    await expect(source.start()).rejects.toMatchObject({
      code: 'permission',
      message: 'Camera permission was denied. Allow the camera in your browser settings and try again.',
    })
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: false,
      video: expect.any(Object),
    }))
    expect(source.getStream()).toBeNull()
    vi.unstubAllGlobals()
  })

  it('reports unavailable camera APIs without requesting capture', async () => {
    vi.stubGlobal('navigator', {})
    const source = new MediaPipeSource('low')

    await expect(source.start()).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(source.getStream()).toBeNull()
    vi.unstubAllGlobals()
  })

  it('releases every camera track and clears the stream when stopped', () => {
    const source = new MediaPipeSource('low')
    const firstTrack = { stop: vi.fn() }
    const secondTrack = { stop: vi.fn() }
    const stream = {
      getTracks: () => [firstTrack, secondTrack],
    } as unknown as MediaStream

    ;(source as unknown as { stream: MediaStream | null }).stream = stream
    expect(source.getStream()).toBe(stream)

    source.stop()

    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
    expect(source.getStream()).toBeNull()
  })

  it('continues releasing remaining tracks if one track throws during shutdown', () => {
    const source = new MediaPipeSource('low')
    const firstTrack = {
      stop: vi.fn(() => {
        throw new Error('device already closed')
      }),
    }
    const secondTrack = { stop: vi.fn() }
    const stream = {
      getTracks: () => [firstTrack, secondTrack],
    } as unknown as MediaStream

    ;(source as unknown as { stream: MediaStream | null }).stream = stream

    expect(() => source.stop()).not.toThrow()
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
    expect(source.getStream()).toBeNull()
  })

  it('is safe to stop repeatedly', () => {
    const source = new MediaPipeSource('low')
    const track = { stop: vi.fn() }
    ;(source as unknown as { stream: MediaStream | null }).stream = {
      getTracks: () => [track],
    } as unknown as MediaStream

    source.stop()
    source.stop()

    expect(track.stop).toHaveBeenCalledOnce()
  })
})
