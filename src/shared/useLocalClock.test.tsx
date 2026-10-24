import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLocalClock } from './useLocalClock'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('atualiza sem interação à meia-noite e depois a cada 30 segundos', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59, 500))
  const { result, unmount } = renderHook(useLocalClock)
  act(() => { vi.advanceTimersByTime(499) })
  expect(result.current.getDate()).toBe(31)
  act(() => { vi.advanceTimersByTime(1) })
  expect(result.current).toEqual(new Date(2027, 0, 1))
  act(() => { vi.advanceTimersByTime(30_000) })
  expect(result.current).toEqual(new Date(2027, 0, 1, 0, 0, 30))
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['focus', 'pageshow', 'visibilitychange'])('reavalia o horário ao receber %s após suspensão', event => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 24, 23, 50))
  const { result } = renderHook(useLocalClock)
  const resumed = new Date(2026, 9, 25, 0, 10)
  vi.setSystemTime(resumed)
  act(() => { (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)) })
  expect(result.current).toEqual(resumed)
})
