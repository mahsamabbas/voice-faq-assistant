import { describe, expect, it } from 'vitest'
import { consumeSseBuffer } from './sse'

describe('consumeSseBuffer', () => {
  it('parses one token event', () => {
    const raw = 'event: token\ndata: {"text":"Hi"}\n\n'
    const { events, rest } = consumeSseBuffer(raw)
    expect(rest).toBe('')
    expect(events[0]).toEqual({ event: 'token', data: { text: 'Hi' } })
  })
})
