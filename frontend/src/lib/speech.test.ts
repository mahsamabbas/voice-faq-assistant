import { describe, expect, it, vi } from 'vitest'

vi.mock('./tts', () => ({
  cancelNeuralTts: vi.fn(),
  speakNeural: vi.fn(async () => false),
  warmNeuralTts: vi.fn(),
}))

import { pickFemaleVoice } from './speech'

function voice(name: string, lang = 'en-US'): SpeechSynthesisVoice {
  return { name, lang } as SpeechSynthesisVoice
}

describe('pickFemaleVoice', () => {
  it('prefers Google US English when available', () => {
    const picked = pickFemaleVoice([
      voice('Samantha'),
      voice('Google US English'),
      voice('Alex'),
    ])
    expect(picked?.name).toBe('Google US English')
  })

  it('skips clearly male names when possible', () => {
    const picked = pickFemaleVoice([voice('Microsoft David'), voice('Microsoft Zira')])
    expect(picked?.name).toBe('Microsoft Zira')
  })
})
