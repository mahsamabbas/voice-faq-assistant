import { describe, expect, it } from 'vitest'
import { consumeSseBuffer, parseSseBlock } from './sse'

describe('consumeSseBuffer', () => {
  it('parses one token event', () => {
    const raw = 'event: token\ndata: {"text":"Hi"}\n\n'
    const { events, rest } = consumeSseBuffer(raw)
    expect(rest).toBe('')
    expect(events[0]).toEqual({ event: 'token', data: { text: 'Hi' } })
  })

  it('parses multiple events and keeps incomplete rest', () => {
    const raw =
      'event: token\ndata: {"text":"A"}\n\nevent: done\ndata: {"ok":true}\n\nevent: token\ndata: {"te'
    const { events, rest } = consumeSseBuffer(raw)
    expect(events).toEqual([
      { event: 'token', data: { text: 'A' } },
      { event: 'done', data: { ok: true } },
    ])
    expect(rest).toBe('event: token\ndata: {"te')
  })

  it('completes a split event across chunks', () => {
    const first = consumeSseBuffer('event: token\ndata: {"te')
    expect(first.events).toEqual([])
    const second = consumeSseBuffer(first.rest + 'xt":"B"}\n\n')
    expect(second.events).toEqual([{ event: 'token', data: { text: 'B' } }])
    expect(second.rest).toBe('')
  })

  it('normalizes CRLF line endings', () => {
    const raw = 'event: token\r\ndata: {"text":"Hi"}\r\n\r\n'
    const { events, rest } = consumeSseBuffer(raw)
    expect(events).toEqual([{ event: 'token', data: { text: 'Hi' } }])
    expect(rest).toBe('')
  })
})

describe('parseSseBlock', () => {
  it('defaults event to message', () => {
    expect(parseSseBlock('data: {"a":1}')).toEqual({ event: 'message', data: { a: 1 } })
  })

  it('returns null for empty, missing data, or invalid JSON', () => {
    expect(parseSseBlock('   ')).toBeNull()
    expect(parseSseBlock('event: token')).toBeNull()
    expect(parseSseBlock('event: token\ndata: {bad')).toBeNull()
  })
})
