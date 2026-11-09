import { clamp } from '../geometry'
import type { FeatureFrame, HandFeatures, HandLandmarks, Landmark, LandmarkFrame } from '../types'

const WRIST = 0
const THUMB_MCP = 2
const THUMB_TIP = 4
const MIDDLE_MCP = 9
const INDEX_MCP = 5
const PINKY_MCP = 17

const FINGERS: Array<{ mcp: number; pip: number; tip: number; thumb: boolean }> = [
  { mcp: THUMB_MCP, pip: 3, tip: THUMB_TIP, thumb: true },
  { mcp: 5, pip: 6, tip: 8, thumb: false },
  { mcp: 9, pip: 10, tip: 12, thumb: false },
  { mcp: 13, pip: 14, tip: 16, thumb: false },
  { mcp: 17, pip: 18, tip: 20, thumb: false },
]

function dist3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function average(points: Landmark[]): Landmark {
  let x = 0
  let y = 0
  let z = 0
  for (const point of points) {
    x += point.x
    y += point.y
    z += point.z
  }
  const count = Math.max(1, points.length)
  return { x: x / count, y: y / count, z: z / count }
}

function normalizeVector(x: number, y: number, z: number): Landmark {
  const length = Math.hypot(x, y, z)
  if (length < 1e-6) return { x: 0, y: 0, z: 0 }
  return { x: x / length, y: y / length, z: z / length }
}

function extensionRatio(world: Landmark[], finger: (typeof FINGERS)[number]): number {
  const wrist = world[WRIST]
  const tip = world[finger.tip]
  const base = world[finger.mcp]
  const pip = world[finger.pip]
  const tipDistance = dist3(wrist, tip)
  const baseDistance = dist3(wrist, base)
  const curlDistance = dist3(tip, pip)
  const size = Math.max(1e-5, baseDistance)
  const reach = tipDistance / size
  const curl = curlDistance / size
  const reachScore = finger.thumb ? (reach - 0.72) / 0.55 : (reach - 0.95) / 0.55
  const curlPenalty = finger.thumb ? 0 : clamp((0.5 - curl) / 0.5, 0, 0.35)
  return clamp(reachScore - curlPenalty, 0, 1)
}

interface PreviousHand {
  tip: Landmark
  palmRoll: number
  timestamp: number
}

export class FeatureExtractor {
  private previous = new Map<string, PreviousHand>()
  private lastDistance: { value: number; timestamp: number } | null = null

  extract(frame: LandmarkFrame): FeatureFrame {
    const hands: HandFeatures[] = []
    const keys: string[] = []

    frame.hands.forEach((hand, index) => {
      const key = hand.handedness === 'Unknown' ? `Unknown-${index}` : hand.handedness
      keys.push(key)
      hands.push(this.extractHand(hand, frame.timestamp, key))
    })

    let twoHandDistance: number | null = null
    let twoHandClosing = 0
    if (hands.length >= 2) {
      const [first, second] = hands
      const averageSize = Math.max(0.02, (first.handSize + second.handSize) / 2)
      // World palm centres are in metres; dividing by hand size keeps the
      // reading stable when the user moves closer to or further from the camera.
      twoHandDistance = dist3(first.worldCenter, second.worldCenter) / averageSize
      if (this.lastDistance && this.lastDistance.timestamp < frame.timestamp) {
        const dt = (frame.timestamp - this.lastDistance.timestamp) / 1000
        if (dt > 0) twoHandClosing = (this.lastDistance.value - twoHandDistance) / dt
      }
      this.lastDistance = { value: twoHandDistance, timestamp: frame.timestamp }
    } else {
      this.lastDistance = null
    }

    for (const key of this.previous.keys()) {
      if (!keys.includes(key)) this.previous.delete(key)
    }

    return { timestamp: frame.timestamp, hands, twoHandDistance, twoHandClosing }
  }

  private extractHand(hand: HandLandmarks, timestamp: number, key: string): HandFeatures {
    const world = hand.world.length === 21 ? hand.world : hand.landmarks
    const points = hand.landmarks.length === 21 ? hand.landmarks : world
    const wrist = world[WRIST]
    const handSize = Math.max(1e-5, dist3(wrist, world[MIDDLE_MCP]))
    const extension = FINGERS.map((finger) => extensionRatio(world, finger))
    const pinchRatio = dist3(world[THUMB_TIP], world[8]) / handSize
    const palmCenter = average([points[WRIST], points[INDEX_MCP], points[9], points[13], points[PINKY_MCP]])
    const worldCenter = average([world[WRIST], world[INDEX_MCP], world[MIDDLE_MCP], world[13], world[PINKY_MCP]])
    const openness = clamp(extension.reduce((sum, value) => sum + value, 0) / extension.length, 0, 1)

    const normal = normalizeVector(
      (world[INDEX_MCP].x - wrist.x),
      (world[INDEX_MCP].y - wrist.y),
      (world[INDEX_MCP].z - wrist.z),
    )
    const across = normalizeVector(
      (world[PINKY_MCP].x - wrist.x),
      (world[PINKY_MCP].y - wrist.y),
      (world[PINKY_MCP].z - wrist.z),
    )
    const facing = clamp(normal.x * across.y - normal.y * across.x, -1, 1)
    const palmRoll = Math.atan2(world[MIDDLE_MCP].y - wrist.y, world[MIDDLE_MCP].x - wrist.x)

    const indexTip = points[8]
    const previous = this.previous.get(key)
    let speed = 0
    let rollRate = 0
    const velocity = { x: 0, y: 0, z: 0 }
    if (previous && timestamp > previous.timestamp) {
      const dt = (timestamp - previous.timestamp) / 1000
      if (dt > 0) {
        velocity.x = (indexTip.x - previous.tip.x) / dt
        velocity.y = (indexTip.y - previous.tip.y) / dt
        velocity.z = (indexTip.z - previous.tip.z) / dt
        speed = Math.hypot(velocity.x, velocity.y, velocity.z)
        let deltaRoll = palmRoll - previous.palmRoll
        while (deltaRoll > Math.PI) deltaRoll -= Math.PI * 2
        while (deltaRoll < -Math.PI) deltaRoll += Math.PI * 2
        rollRate = deltaRoll / dt
      }
    }
    this.previous.set(key, { tip: { ...indexTip }, palmRoll, timestamp })

    const twoFinger = extension[1] > 0.6 && extension[2] > 0.6 && extension[3] < 0.45 && extension[4] < 0.45
    const claw =
      openness > 0.2 &&
      openness < 0.78 &&
      pinchRatio > 0.45 &&
      extension.every((value) => value > 0.15 && value < 0.85)
    const point = extension[1] > 0.65 && extension[2] < 0.45 && extension[3] < 0.4 && extension[4] < 0.4

    const vector = [
      extension[0],
      extension[1],
      extension[2],
      extension[3],
      extension[4],
      clamp(pinchRatio / 1.5, 0, 1.5),
      openness,
      twoFinger ? 1 : 0,
      claw ? 1 : 0,
      point ? 1 : 0,
      clamp(speed / 2, 0, 1),
      clamp(Math.abs(rollRate) / 4, 0, 1),
    ]

    return {
      hand: hand.handedness,
      extension,
      pinchRatio,
      openness,
      palmFacing: facing,
      palmRoll,
      rollRate,
      speed,
      handSize,
      indexTip: { ...indexTip },
      velocity,
      palmCenter,
      worldCenter,
      twoFinger,
      claw,
      score: hand.score,
      vector,
    }
  }

  reset(): void {
    this.previous.clear()
    this.lastDistance = null
  }
}
