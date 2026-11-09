import * as THREE from 'three'
import type { BoundsInput, ModelPartInput } from './intelligence'

const MAX_ANALYSIS_PARTS = 400

function sanitizeExtras(userData: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!userData) return null
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(userData)) {
    if (key.startsWith('__bozz')) continue
    if (value === undefined || typeof value === 'function') continue
    try {
      JSON.stringify(value)
      clean[key] = value
    } catch {
      // Circular or non-serialisable; skipped rather than guessed.
    }
  }
  return Object.keys(clean).length > 0 ? clean : null
}

function subtreeStats(object: THREE.Object3D): {
  vertices: number
  triangles: number
  materialNames: string[]
} {
  let vertices = 0
  let triangles = 0
  const materialNames = new Set<string>()
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const position = mesh.geometry.getAttribute('position')
    if (position) vertices += position.count
    if (mesh.geometry.index) triangles += mesh.geometry.index.count / 3
    else if (position) triangles += position.count / 3
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      if (material?.name?.trim()) materialNames.add(material.name.trim())
    }
  })
  return { vertices, triangles: Math.floor(triangles), materialNames: [...materialNames] }
}

function hasMesh(object: THREE.Object3D): boolean {
  let found = false
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found = true
  })
  return found
}

export function collectSceneParts(root: THREE.Object3D): {
  parts: ModelPartInput[]
  bounds: BoundsInput
  center: [number, number, number]
  warning: string | null
} {
  root.updateMatrixWorld(true)
  const parts: ModelPartInput[] = []
  let truncated = false

  const walk = (object: THREE.Object3D, parentPath: string | null, depth: number) => {
    object.children.forEach((child, index) => {
      if (parts.length >= MAX_ANALYSIS_PARTS) {
        truncated = true
        return
      }
      if (!(child as THREE.Mesh).isMesh && !hasMesh(child)) return
      const fallbackName = `${child.type || 'Node'} ${index + 1}`
      const name = child.name.trim() || fallbackName
      const nodePath = parentPath ? `${parentPath}/${name}#${index}` : `${name}#${index}`
      const box = new THREE.Box3().setFromObject(child)
      if (box.isEmpty()) {
        if (child.children.length > 0) walk(child, nodePath, depth + 1)
        return
      }
      const min = box.min
      const max = box.max
      const size: [number, number, number] = [max.x - min.x, max.y - min.y, max.z - min.z]
      const stats = subtreeStats(child)
      parts.push({
        nodePath,
        parentPath,
        name,
        type: child.type,
        extras: sanitizeExtras(child.userData),
        vertices: stats.vertices,
        triangles: stats.triangles,
        bounds: {
          min: [min.x, min.y, min.z],
          max: [max.x, max.y, max.z],
        },
        center: [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2],
        bboxVolume: size[0] * size[1] * size[2],
        materialNames: stats.materialNames,
        depth,
      })
      walk(child, nodePath, depth + 1)
    })
  }

  walk(root, null, 0)

  const assemblyBox = new THREE.Box3().setFromObject(root)
  const size = assemblyBox.getSize(new THREE.Vector3())
  const centre = assemblyBox.getCenter(new THREE.Vector3())
  return {
    parts,
    bounds: {
      min: [assemblyBox.min.x, assemblyBox.min.y, assemblyBox.min.z],
      max: [assemblyBox.max.x, assemblyBox.max.y, assemblyBox.max.z],
    },
    center: [centre.x, centre.y, centre.z],
    warning: truncated
      ? `Only the first ${MAX_ANALYSIS_PARTS} nodes were analysed. The model contains more. Bounding-box volume is ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} units.`
      : null,
  }
}
