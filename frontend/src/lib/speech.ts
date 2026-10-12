/* Web Speech API helpers (recognition + synthesis). Chrome-first. */

interface RecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}
interface RecognitionErrorLike {
  error: string
}
interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives?: number
  onresult: ((e: RecognitionEventLike) => void) | null
  onerror: ((e: RecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => RecognitionLike

/** Pause after last heard speech before auto-sending the question. */
const SILENCE_MS = 1400

function getCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function speechSupported(): boolean {
  return Boolean(getCtor()) && typeof window !== 'undefined' && 'speechSynthesis' in window
}

export interface Recognizer {
  start: () => void
  /** Stop listening early; the final transcript is delivered via onFinal. */
  stop: () => void
  abort: () => void
}

export function createRecognizer(
  onPartial: (text: string) => void,
  onFinal: (text: string) => void,
  onError: (message: string) => void,
): Recognizer | null {
  const Ctor = getCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1

  let finalText = ''
  let delivered = false
  let failed = false
  let stopping = false
  let heardSpeech = false
  let silenceTimer: number | null = null

  const clearSilence = () => {
    if (silenceTimer !== null) {
      window.clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  const finishListening = () => {
    if (delivered || failed || stopping) return
    stopping = true
    clearSilence()
    try {
      rec.stop()
    } catch {
      deliver()
    }
  }

  const armSilence = () => {
    clearSilence()
    silenceTimer = window.setTimeout(() => {
      // User paused — send automatically (no second mic tap).
      if (heardSpeech && !delivered && !failed) finishListening()
    }, SILENCE_MS)
  }

  const deliver = () => {
    if (delivered) return
    delivered = true
    clearSilence()
    onFinal(finalText.trim())
  }

  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const piece = r[0]?.transcript ?? ''
      if (r.isFinal) finalText += piece
      else interim += piece
    }
    const live = `${finalText}${interim}`.replace(/\s+/g, ' ').trim()
    if (live) {
      heardSpeech = true
      onPartial(live)
      armSilence()
    }
  }
  rec.onerror = (e) => {
    if (e.error === 'aborted') return
    if (e.error === 'no-speech' && !stopping) return
    failed = true
    delivered = true
    clearSilence()
    if (e.error === 'no-speech') onError('No speech detected. Try again.')
    else if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      onError('Microphone permission was denied.')
    else onError(`Speech recognition error: ${e.error}`)
  }
  rec.onend = () => {
    if (!stopping && !failed && !delivered) {
      // Chrome sometimes ends the session early — restart until silence/stop.
      try {
        rec.start()
        return
      } catch {
        // fall through
      }
    }
    if (!failed) deliver()
  }

  return {
    start: () => {
      finalText = ''
      delivered = false
      failed = false
      stopping = false
      heardSpeech = false
      clearSilence()
      rec.start()
    },
    stop: () => finishListening(),
    abort: () => {
      stopping = true
      delivered = true
      clearSilence()
      rec.abort()
    },
  }
}

export function cancelSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([])
  }
  const syn = window.speechSynthesis
  const current = syn.getVoices()
  if (current.length > 0) return Promise.resolve(current)

  return new Promise((resolve) => {
    const done = () => resolve(syn.getVoices())
    syn.addEventListener('voiceschanged', done, { once: true })
    window.setTimeout(done, 400)
  })
}

/** Prefer a natural, lighter female English voice when the OS provides one. */
export function pickFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const pool = en.length > 0 ? en : voices
  if (pool.length === 0) return null

  const preferred = [
    /samantha/i,
    /victoria/i,
    /karen/i,
    /moira/i,
    /tessa/i,
    /fiona/i,
    /veena/i,
    /raveena/i,
    /zira/i,
    /jenny/i,
    /aria/i,
    /natasha/i,
    /susan/i,
    /female/i,
  ]
  for (const re of preferred) {
    const hit = pool.find((v) => re.test(v.name))
    if (hit) return hit
  }

  const soft = pool.find(
    (v) => !/male|david|mark|daniel|fred|tom|george|james|aaron|gordon/i.test(v.name),
  )
  return soft ?? pool[0] ?? null
}

/** Queue sentences for TTS. Returns a promise that resolves when the last one ends. */
export async function speakSentences(sentences: string[], muted: boolean): Promise<void> {
  if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return
  }
  const items = sentences.map((s) => s.trim()).filter(Boolean)
  if (items.length === 0) return

  const voices = await loadVoices()
  const voice = pickFemaleVoice(voices)

  return new Promise<void>((resolve) => {
    items.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = voice?.lang || 'en-US'
      if (voice) u.voice = voice
      // Slightly brighter / lighter female delivery.
      u.pitch = 1.18
      u.rate = 1.02
      u.volume = 1
      if (i === items.length - 1) {
        u.onend = () => resolve()
        u.onerror = () => resolve()
      }
      window.speechSynthesis.speak(u)
    })
  })
}
