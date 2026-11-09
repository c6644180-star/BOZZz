'use strict'

/**
 * Pure geometry for the mini orb window. Electron's screen module supplies
 * `workArea`, which already excludes the Windows taskbar. Every value here is
 * plain numbers so the rules can be unit tested without starting Electron.
 */

const DOCK_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeArea(area) {
  const width = Math.max(0, finite(area && area.width))
  const height = Math.max(0, finite(area && area.height))
  return {
    x: finite(area && area.x),
    y: finite(area && area.y),
    width,
    height,
  }
}

function clampValue(value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function clampToWorkArea(x, y, width, height, area, margin = 0) {
  const bounds = normalizeArea(area)
  const safeMargin = Math.max(0, finite(margin))
  const minX = bounds.x + safeMargin
  const minY = bounds.y + safeMargin
  const maxX = Math.max(minX, bounds.x + bounds.width - Math.max(0, finite(width)) - safeMargin)
  const maxY = Math.max(minY, bounds.y + bounds.height - Math.max(0, finite(height)) - safeMargin)
  return {
    x: Math.round(clampValue(finite(x), minX, maxX)),
    y: Math.round(clampValue(finite(y), minY, maxY)),
  }
}

function dockPoint(corner, area, width, height, margin = 16) {
  const bounds = normalizeArea(area)
  const safeMargin = Math.max(0, finite(margin))
  const left = bounds.x + safeMargin
  const top = bounds.y + safeMargin
  const right = bounds.x + bounds.width - Math.max(0, finite(width)) - safeMargin
  const bottom = bounds.y + bounds.height - Math.max(0, finite(height)) - safeMargin
  const target =
    corner === 'top-left'
      ? { x: left, y: top }
      : corner === 'top-right'
        ? { x: right, y: top }
        : corner === 'bottom-left'
          ? { x: left, y: bottom }
          : { x: right, y: bottom }
  return clampToWorkArea(target.x, target.y, width, height, bounds, safeMargin)
}

function randomTarget(area, width, height, margin = 16, random = Math.random) {
  const bounds = normalizeArea(area)
  const safeMargin = Math.max(0, finite(margin))
  const minX = bounds.x + safeMargin
  const minY = bounds.y + safeMargin
  const maxX = Math.max(minX, bounds.x + bounds.width - Math.max(0, finite(width)) - safeMargin)
  const maxY = Math.max(minY, bounds.y + bounds.height - Math.max(0, finite(height)) - safeMargin)
  const roll = typeof random === 'function' ? random() : Math.random()
  const safeRoll = clampValue(Number.isFinite(roll) ? roll : 0, 0, 1)
  const rollY = typeof random === 'function' ? random() : Math.random()
  const safeRollY = clampValue(Number.isFinite(rollY) ? rollY : 0, 0, 1)
  return {
    x: Math.round(minX + (maxX - minX) * safeRoll),
    y: Math.round(minY + (maxY - minY) * safeRollY),
  }
}

function easeInOut(progress) {
  const t = clampValue(finite(progress), 0, 1)
  return t * t * (3 - 2 * t)
}

function stepToward(from, to, progress) {
  const start = { x: finite(from && from.x), y: finite(from && from.y) }
  const end = { x: finite(to && to.x), y: finite(to && to.y) }
  const eased = easeInOut(progress)
  return {
    x: Math.round(start.x + (end.x - start.x) * eased),
    y: Math.round(start.y + (end.y - start.y) * eased),
  }
}

function isInsideWorkArea(x, y, width, height, area) {
  const bounds = normalizeArea(area)
  const px = finite(x)
  const py = finite(y)
  const w = Math.max(0, finite(width))
  const h = Math.max(0, finite(height))
  return (
    px >= bounds.x &&
    py >= bounds.y &&
    px + w <= bounds.x + bounds.width &&
    py + h <= bounds.y + bounds.height
  )
}

module.exports = {
  DOCK_CORNERS,
  normalizeArea,
  clampToWorkArea,
  dockPoint,
  randomTarget,
  easeInOut,
  stepToward,
  isInsideWorkArea,
}
