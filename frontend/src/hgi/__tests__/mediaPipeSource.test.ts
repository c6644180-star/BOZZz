import { describe, expect, it, vi } from 'vitest'
import { MediaPipeSource } from '../landmarks/MediaPipeSource'

describe('MediaPipeSource camera lifecycle', () => {
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
