import { OneEuroFilter } from './OneEuroFilter'
import type { HandLandmarks, Landmark, LandmarkFrame } from '../types'
import { clamp } from '../geometry'

const POINTS = 21

class HandTrack {
  key: string
  lastSeen = 0
  filters: OneEuroFilter[] = []
  worldFilters: OneEuroFilter[] = []
  score = 0
  handedness: HandLandmarks['handedness'] = 'Unknown'
  outLandmarks: Landmark[] = []
  outWorld: Landmark[] = []

  constructor(key: string) {
    this.key = key
    for (let index = 0; index < POINTS * 3; index += 1) {
      this.filters.push(new OneEuroFilter())
      this.worldFilters.push(new OneEuroFilter())
    }
    for (let index = 0; index < POINTS; index += 1) {
      this.outLandmarks.push({ x: 0, y: 0, z: 0 })
      this.outWorld.push({ x: 0, y: 0, z: 0 })
    }
  }

  update(hand: HandLandmarks, timestamp: number, minCutoff: number, beta: number, fps: number): HandLandmarks {
    this.lastSeen = timestamp
    this.score = hand.score
    this.handedness = hand.handedness
    const predictionSeconds = 1 / Math.max(1, fps)

    for (let index = 0; index < POINTS; index += 1) {
      const source = hand.landmarks[index] ?? { x: 0, y: 0, z: 0 }
      const world = hand.world[index] ?? source
      const output = this.outLandmarks[index]
      const outputWorld = this.outWorld[index]
      for (let axis = 0; axis < 3; axis += 1) {
        const key = index * 3 + axis
        const filter = this.filters[key]
        filter.minCutoff = minCutoff
        filter.beta = beta
        filter.freq = fps
        const value = axis === 0 ? source.x : axis === 1 ? source.y : source.z
        const filtered = filter.filter(value, timestamp)
        const predicted = clamp(filter.velocity * predictionSeconds, -0.04, 0.04)
        if (axis === 0) output.x = filtered + predicted
        else if (axis === 1) output.y = filtered + predicted
        else output.z = filtered + predicted

        const worldFilter = this.worldFilters[key]
        worldFilter.minCutoff = minCutoff
        worldFilter.beta = beta
        worldFilter.freq = fps
        const worldValue = axis === 0 ? world.x : axis === 1 ? world.y : world.z
        const worldFiltered = worldFilter.filter(worldValue, timestamp)
        const worldPredicted = clamp(worldFilter.velocity * predictionSeconds, -0.03, 0.03)
        if (axis === 0) outputWorld.x = worldFiltered + worldPredicted
        else if (axis === 1) outputWorld.y = worldFiltered + worldPredicted
        else outputWorld.z = worldFiltered + worldPredicted
      }
    }

    return {
      landmarks: this.outLandmarks,
      world: this.outWorld,
      handedness: this.handedness,
      score: this.score,
    }
  }

  reset(): void {
    for (const filter of this.filters) filter.reset()
    for (const filter of this.worldFilters) filter.reset()
  }
}

export class HandFilterSet {
  private tracks = new Map<string, HandTrack>()

  update(frame: LandmarkFrame, minCutoff: number, beta: number, fps = 20): LandmarkFrame {
    const hands: HandLandmarks[] = []
    const seen = new Set<string>()

    frame.hands.forEach((hand, index) => {
      const key = hand.handedness === 'Unknown' ? `Unknown-${index}` : hand.handedness
      seen.add(key)
      let track = this.tracks.get(key)
      if (!track) {
        track = new HandTrack(key)
        this.tracks.set(key, track)
      }
      const filtered = track.update(hand, frame.timestamp, minCutoff, beta, fps)
      hands.push({
        landmarks: filtered.landmarks,
        world: filtered.world,
        handedness: filtered.handedness,
        score: hand.score,
      })
    })

    for (const [key, track] of this.tracks) {
      if (!seen.has(key) && frame.timestamp - track.lastSeen > 500) {
        track.reset()
        this.tracks.delete(key)
      }
    }

    return { ...frame, hands }
  }

  reset(): void {
    for (const track of this.tracks.values()) track.reset()
    this.tracks.clear()
  }
}
