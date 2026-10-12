import { describe, expect, it } from 'vitest'
import { pullSentences } from './sentences'

describe('pullSentences', () => {
  it('emits complete sentences and keeps remainder', () => {
    const r = pullSentences('Hello there. More')
    expect(r.sentences).toEqual(['Hello there.'])
    expect(r.rest).toBe(' More')
  })

  it('keeps unfinished text', () => {
    const r = pullSentences('Hello')
    expect(r.sentences).toEqual([])
    expect(r.rest).toBe('Hello')
  })
})
