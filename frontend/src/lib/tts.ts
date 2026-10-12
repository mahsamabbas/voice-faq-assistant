/**
 * Neural TTS via Kokoro (browser ONNX). Natural American English —
 * far closer to ChatGPT-style speech than Web Speech API.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/** Best-graded American female voice in Kokoro. */
const VOICE = 'af_heart' as const
const SPEED = 1.05

type KokoroModule = typeof import('kokoro-js')
type TtsReady = InstanceType<KokoroModule['KokoroTTS']>

let engine: TtsReady | null = null
let loadPromise: Promise<TtsReady | null> | null = null
let cancelled = false
let currentAudio: HTMLAudioElement | null = null
let objectUrl: string | null = null
/** Serialize speak jobs so streaming sentences stay in order. */
let speakChain: Promise<void> = Promise.resolve()

function revokeUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

function stopAudio(): void {
  if (currentAudio) {
    currentAudio.onended = null
    currentAudio.onerror = null
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  revokeUrl()
}

async function loadEngine(): Promise<TtsReady | null> {
  if (engine) return engine
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      // Lazy-load so the main UI bundle stays small.
      const { KokoroTTS } = await import('kokoro-js')
      // Prefer WebGPU when available; WASM q8 is the reliable fallback.
      try {
        engine = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'fp32',
          device: 'webgpu',
        })
      } catch {
        engine = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
        })
      }
      return engine
    } catch (err) {
      console.warn('Kokoro TTS failed to load; falling back to Web Speech.', err)
      return null
    } finally {
      loadPromise = null
    }
  })()

  return loadPromise
}

/** Prefetch the neural model so the first spoken answer is not stalled. */
export function warmNeuralTts(): void {
  if (typeof window === 'undefined') return
  void loadEngine()
}

export function neuralTtsSupported(): boolean {
  return typeof window !== 'undefined'
}

export function cancelNeuralTts(): void {
  cancelled = true
  stopAudio()
  // Drop queued work; new speaks start a fresh chain.
  speakChain = Promise.resolve()
}

function playRawAudio(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    if (cancelled) {
      resolve()
      return
    }
    stopAudio()
    objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    currentAudio = audio
    const done = () => {
      if (currentAudio === audio) {
        currentAudio = null
        revokeUrl()
      }
      resolve()
    }
    audio.onended = done
    audio.onerror = done
    void audio.play().catch(done)
  })
}

async function speakOne(text: string, tts: TtsReady): Promise<void> {
  if (cancelled || !text.trim()) return
  const raw = await tts.generate(text.trim(), { voice: VOICE, speed: SPEED })
  if (cancelled) return
  await playRawAudio(raw.toBlob())
}

/**
 * Speak sentences with Kokoro. Returns false if the engine is unavailable
 * (caller should fall back to Web Speech).
 */
export async function speakNeural(sentences: string[]): Promise<boolean> {
  const items = sentences.map((s) => s.trim()).filter(Boolean)
  if (items.length === 0) return true

  cancelled = false
  const tts = await loadEngine()
  if (!tts) return false

  const job = speakChain.then(async () => {
    for (const text of items) {
      if (cancelled) return
      await speakOne(text, tts)
    }
  })
  // Keep the chain alive even if a job fails.
  speakChain = job.catch(() => {})
  await job
  return true
}
