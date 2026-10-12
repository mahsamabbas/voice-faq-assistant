import { consumeSseBuffer } from './sse'

export const API_BASE: string =
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? 'http://localhost:8002'

export type Role = 'user' | 'assistant'

export interface HistoryMessage {
  role: Role
  content: string
}

export interface Status {
  filename: string
  source: string
  ollama_ok: boolean
}

export interface ChatHandlers {
  onToken: (text: string) => void
  onDone: (refused: boolean) => void
  onRefusal: (answer: string) => void
  onError: (message: string) => void
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    const detail = body?.detail
    if (typeof detail === 'string' && detail) return detail
  } catch {
    /* ignore non-JSON error bodies */
  }
  return fallback
}

export async function getStatus(): Promise<Status> {
  const res = await fetch(`${API_BASE}/status`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not load FAQ status.'))
  return (await res.json()) as Status
}

export async function uploadFaq(file: File): Promise<Status> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await errorMessage(res, 'Upload failed.'))
  return (await res.json()) as Status
}

/** Keep only the last three messages for the API. */
export function trimHistory(history: HistoryMessage[]): HistoryMessage[] {
  return history.slice(-3)
}

export async function sendChat(
  message: string,
  history: HistoryMessage[],
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: trimHistory(history) }),
      signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    handlers.onError('Could not reach the server.')
    return
  }

  if (!res.ok) {
    handlers.onError(await errorMessage(res, `Request failed (${res.status}).`))
    return
  }

  const type = res.headers.get('content-type') ?? ''

  if (type.includes('application/json')) {
    try {
      const body = (await res.json()) as { answer?: string }
      handlers.onRefusal(body.answer ?? '')
    } catch {
      handlers.onError('Invalid response from server.')
    }
    return
  }

  if (!res.body) {
    handlers.onError('Empty response from server.')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  const handleEvents = (events: Array<{ event: string; data: unknown }>) => {
    for (const { event, data } of events) {
      const d = (data ?? {}) as { text?: string; refused?: boolean; detail?: string }
      if (event === 'token') {
        if (d.text) handlers.onToken(d.text)
      } else if (event === 'done') {
        finished = true
        handlers.onDone(Boolean(d.refused))
      } else if (event === 'error') {
        finished = true
        handlers.onError(d.detail || 'Answer service unavailable')
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { events, rest } = consumeSseBuffer(buffer)
      buffer = rest
      handleEvents(events)
    }
    buffer += decoder.decode()
    if (buffer.trim()) handleEvents(consumeSseBuffer(buffer + '\n\n').events)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    handlers.onError('Connection lost while streaming the answer.')
    return
  }

  if (!finished) handlers.onDone(false)
}
