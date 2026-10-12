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
  onresult: ((e: RecognitionEventLike) => void) | null
  onerror: ((e: RecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => RecognitionLike

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
  /** Stop listening; the final transcript is delivered via onFinal. */
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
  rec.continuous = false
  rec.interimResults = true

  let finalText = ''
  let delivered = false
  let failed = false

  const deliver = () => {
    if (delivered) return
    delivered = true
    onFinal(finalText.trim())
  }

  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    onPartial((finalText + interim).trim())
  }
  rec.onerror = (e) => {
    if (e.error === 'aborted') return
    failed = true
    delivered = true
    if (e.error === 'no-speech') onError('No speech detected. Try again.')
    else if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      onError('Microphone permission was denied.')
    else onError(`Speech recognition error: ${e.error}`)
  }
  rec.onend = () => {
    if (!failed) deliver()
  }

  return {
    start: () => {
      finalText = ''
      delivered = false
      failed = false
      rec.start()
    },
    stop: () => rec.stop(),
    abort: () => {
      delivered = true
      rec.abort()
    },
  }
}

export function cancelSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

/** Queue sentences for TTS. Returns a promise that resolves when the last one ends. */
export function speakSentences(sentences: string[], muted: boolean): Promise<void> {
  if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve()
  }
  const items = sentences.map((s) => s.trim()).filter(Boolean)
  if (items.length === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    items.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      if (i === items.length - 1) {
        u.onend = () => resolve()
        u.onerror = () => resolve()
      }
      window.speechSynthesis.speak(u)
    })
  })
}
