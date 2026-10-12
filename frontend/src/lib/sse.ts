export function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const trimmed = block.trim()
  if (!trimmed) return null

  let event = 'message'
  let dataLine = ''

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLine = line.slice('data:'.length).trim()
    }
  }

  if (!dataLine) return null

  try {
    return { event, data: JSON.parse(dataLine) }
  } catch {
    return null
  }
}

export function consumeSseBuffer(buffer: string): {
  events: Array<{ event: string; data: unknown }>
  rest: string
} {
  const events: Array<{ event: string; data: unknown }> = []
  let rest = buffer

  while (true) {
    const sep = rest.indexOf('\n\n')
    if (sep === -1) break
    const block = rest.slice(0, sep)
    rest = rest.slice(sep + 2)
    const parsed = parseSseBlock(block)
    if (parsed) events.push(parsed)
  }

  return { events, rest }
}
