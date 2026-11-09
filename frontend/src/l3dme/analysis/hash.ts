function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}-${bytes.length.toString(16)}`
}

/** SHA-256 of the exact bytes when the browser exposes Web Crypto. */
export async function hashModelFile(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (subtle?.digest) {
    try {
      const digest = await subtle.digest('SHA-256', buffer)
      return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
    } catch {
      // Fall through to the deterministic non-cryptographic hash.
    }
  }
  return `fnv1a-${fnv1a(bytes)}`
}
