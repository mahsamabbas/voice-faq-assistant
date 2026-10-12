import { describe, expect, it } from 'vitest'
import { pickFemaleVoice } from './speech'

function voice(name: string, lang = 'en-US'): SpeechSynthesisVoice {
  return { name, lang } as SpeechSynthesisVoice
}

describe('pickFemaleVoice', () => {
  it('prefers Samantha when available', () => {
    const picked = pickFemaleVoice([
      voice('Google US English'),
      voice('Samantha'),
      voice('Alex'),
    ])
    expect(picked?.name).toBe('Samantha')
  })

  it('skips clearly male names when possible', () => {
    const picked = pickFemaleVoice([voice('Microsoft David'), voice('Microsoft Zira')])
    expect(picked?.name).toBe('Microsoft Zira')
  })
})
