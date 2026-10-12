const COMPLETE_SENTENCE = /[^.!?]*[.!?](?=\s|$)/g

export function pullSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  COMPLETE_SENTENCE.lastIndex = 0
  while ((match = COMPLETE_SENTENCE.exec(buffer)) !== null) {
    sentences.push(match[0])
    lastIndex = match.index + match[0].length
  }
  return { sentences, rest: buffer.slice(lastIndex) }
}
