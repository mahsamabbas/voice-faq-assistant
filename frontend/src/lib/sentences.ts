export function pullSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let lastIndex = 0
  const delimiterRegex = /[.!?]+(?=\s|$)/g
  let match: RegExpExecArray | null
  while ((match = delimiterRegex.exec(buffer)) !== null) {
    const endIndex = match.index + match[0].length
    sentences.push(buffer.slice(lastIndex, endIndex))
    lastIndex = endIndex
  }
  return { sentences, rest: buffer.slice(lastIndex) }
}
