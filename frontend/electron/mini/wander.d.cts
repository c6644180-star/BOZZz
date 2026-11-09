export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type DockCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export declare const DOCK_CORNERS: DockCorner[]
export declare function normalizeArea(area: Partial<WorkArea> | null | undefined): WorkArea
export declare function clampToWorkArea(
  x: number,
  y: number,
  width: number,
  height: number,
  area: Partial<WorkArea>,
  margin?: number,
): Point
export declare function dockPoint(
  corner: DockCorner | string,
  area: Partial<WorkArea>,
  width: number,
  height: number,
  margin?: number,
): Point
export declare function randomTarget(
  area: Partial<WorkArea>,
  width: number,
  height: number,
  margin?: number,
  random?: () => number,
): Point
export declare function easeInOut(progress: number): number
export declare function stepToward(from: Partial<Point>, to: Partial<Point>, progress: number): Point
export declare function isInsideWorkArea(
  x: number,
  y: number,
  width: number,
  height: number,
  area: Partial<WorkArea>,
): boolean
