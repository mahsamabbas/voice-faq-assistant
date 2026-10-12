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

describe('pullSentences edge cases', () => {
  it('does not split on decimals and preserves leading text', () => {
    const r = pullSentences('It costs $3.50 today. Next')
    expect(r.sentences).toEqual(['It costs $3.50 today.'])
    expect(r.rest).toBe(' Next')
  })

  it('keeps an incomplete decimal in rest', () => {
    const r = pullSentences('Price is $3.')
    expect(r.sentences).toEqual(['Price is $3.'])
    const r2 = pullSentences('Price is $3.5')
    expect(r2.sentences).toEqual([])
    expect(r2.rest).toBe('Price is $3.5')
  })

  it('emits multiple sentences with no data loss', () => {
    const input = 'One. Two! Three? Four'
    const r = pullSentences(input)
    expect(r.sentences).toEqual(['One.', ' Two!', ' Three?'])
    expect(r.sentences.join('') + r.rest).toBe(input)
  })

  it('treats ellipses as a single delimiter', () => {
    const input = 'Wait... what? Yes'
    const r = pullSentences(input)
    expect(r.sentences).toEqual(['Wait...', ' what?'])
    expect(r.rest).toBe(' Yes')
    expect(r.sentences.join('') + r.rest).toBe(input)
  })

  it('does not split inside URLs', () => {
    const input = 'See example.com/a.b for info. Done'
    const r = pullSentences(input)
    expect(r.sentences).toEqual(['See example.com/a.b for info.'])
    expect(r.rest).toBe(' Done')
  })
})
