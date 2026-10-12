import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendChat } from './api'

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function handlers() {
  return { onToken: vi.fn(), onDone: vi.fn(), onRefusal: vi.fn(), onError: vi.fn() }
}

afterEach(() => vi.unstubAllGlobals())

describe('sendChat stream termination', () => {
  it('calls onDone when a done event arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse(['event: token\ndata: {"text":"Hi."}\n\nevent: done\ndata: {"refused":false}\n\n']),
    ))
    const h = handlers()
    await sendChat('q', [], h)
    expect(h.onToken).toHaveBeenCalledWith('Hi.')
    expect(h.onDone).toHaveBeenCalledWith(false)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('calls onError when the stream ends without done or error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse(['event: token\ndata: {"text":"Hi."}\n\n']),
    ))
    const h = handlers()
    await sendChat('q', [], h)
    expect(h.onDone).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledTimes(1)
  })
})
