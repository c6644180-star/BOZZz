export interface Point {
  x: number
  y: number
}

export interface ControlRect {
  left: number
  top: number
  width: number
  height: number
  margin: number
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function distance2D(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Camera frames are not mirrored by the browser. Mirroring x makes the
// virtual cursor and the on-screen preview move with the user's hand.
export function mapCameraToViewport(
  nx: number,
  ny: number,
  width: number,
  height: number,
  mirror = true,
  insetFraction = 0.04,
): Point {
  const x = clamp01(mirror ? 1 - nx : nx)
  const y = clamp01(ny)
  const insetX = width * insetFraction
  const insetY = height * insetFraction
  return {
    x: insetX + x * Math.max(0, width - insetX * 2),
    y: insetY + y * Math.max(0, height - insetY * 2),
  }
}

export function controlRect(
  width: number,
  height: number,
  area: number,
  margin = 12,
  offsetX = 0,
  offsetY = 0,
): ControlRect {
  const fraction = clamp(area, 0.3, 1)
  const w = width * fraction
  const h = height * fraction
  return {
    left: clamp((width - w) / 2 + width * clamp(offsetX, -0.5, 0.5), 0, Math.max(0, width - w)),
    top: clamp((height - h) / 2 + height * clamp(offsetY, -0.5, 0.5), 0, Math.max(0, height - h)),
    width: w,
    height: h,
    margin,
  }
}

// Normalised hand coordinates to a screen rectangle whose corners stay
// reachable because of the inner edge margin.
export function controlPoint(nx: number, ny: number, rect: ControlRect): Point {
  const innerW = Math.max(1, rect.width - rect.margin * 2)
  const innerH = Math.max(1, rect.height - rect.margin * 2)
  return {
    x: rect.left + rect.margin + clamp01(nx) * innerW,
    y: rect.top + rect.margin + clamp01(ny) * innerH,
  }
}

export function applySensitivity(nx: number, ny: number, sensitivity: number): Point {
  const scale = clamp(sensitivity, 0.3, 2.5)
  return {
    x: clamp01(0.5 + (nx - 0.5) * scale),
    y: clamp01(0.5 + (ny - 0.5) * scale),
  }
}
