import { describe, expect, it, vi } from 'vitest'
import { id } from './db'

describe('IDs em navegadores sem randomUUID (HTTP no celular)', () => {
  it('gera IDs válidos e distintos sem depender de contexto seguro', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    try {
      const ids = Array.from({ length: 100 }, id)
      expect(new Set(ids).size).toBe(100)
      expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally { vi.unstubAllGlobals() }
  })
})
