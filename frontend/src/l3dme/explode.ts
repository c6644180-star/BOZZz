export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ExplodeSourcePart {
  key: string
  base: Vec3
}

export interface ExplodePlanItem extends ExplodeSourcePart {
  direction: Vec3
  spread: number
}

export function clampExplode(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function directionFromCenter(base: Vec3, center: Vec3): Vec3 {
  const dx = base.x - center.x
  const dy = base.y - center.y
  const dz = base.z - center.z
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-6) return { x: 0, y: 0, z: 0 }
  return { x: dx / length, y: dy / length, z: dz / length }
}

export function buildExplodePlan(
  parts: ExplodeSourcePart[],
  center: Vec3,
  spread: number,
): ExplodePlanItem[] {
  const safeSpread = Number.isFinite(spread) ? Math.max(0, spread) : 0
  return parts.map((part) => ({
    key: part.key,
    base: { ...part.base },
    direction: directionFromCenter(part.base, center),
    spread: safeSpread,
  }))
}

export function explodedPosition(item: ExplodePlanItem, amount: number): Vec3 {
  const value = clampExplode(amount)
  const distance = item.spread * value
  return {
    x: item.base.x + item.direction.x * distance,
    y: item.base.y + item.direction.y * distance,
    z: item.base.z + item.direction.z * distance,
  }
}

export function applyExplodePlan(
  plan: ExplodePlanItem[],
  amount: number,
): Array<{ key: string; position: Vec3 }> {
  return plan.map((item) => ({ key: item.key, position: explodedPosition(item, amount) }))
}
