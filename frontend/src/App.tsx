import { useCallback, useEffect, useRef, useState } from 'react'
import { getStatus, sendChat, trimHistory, uploadFaq } from './lib/api'
import type { HistoryMessage, Status } from './lib/api'
import { pullSentences } from './lib/sentences'
import {
  cancelSpeech,
  createRecognizer,
  speakSentences,
  speechSupported,
} from './lib/speech'
import type { Recognizer } from './lib/speech'

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** Assistant only: undefined while streaming. */
  refused?: boolean
}

const STATUS: Record<OrbState, string> = {
  idle: 'Tap the orb and ask your FAQ anything',
  listening: 'Listening… tap again to send',
  thinking: 'Finding the answer…',
  speaking: 'Speaking…',
}

export default function App() {
  const [state, setState] = useState<OrbState>('idle')
  const [muted, setMuted] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [partial, setPartial] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [faq, setFaq] = useState<Status | null>(null)
  const [uploading, setUploading] = useState(false)
  const supported = speechSupported()

  const mutedRef = useRef(muted)
  const recognizerRef = useRef<Recognizer | null>(null)
  const historyRef = useRef<HistoryMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const turnRef = useRef(0)
  const nextId = useRef(1)
  const fileRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mutedRef.current = muted
    if (muted) cancelSpeech()
  }, [muted])

  useEffect(() => {
    getStatus().then(setFaq).catch(() => setError('Could not reach the EchoFAQ server.'))
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, partial])

  useEffect(
    () => () => {
      recognizerRef.current?.abort()
      abortRef.current?.abort()
      cancelSpeech()
    },
    [],
  )

  const stopEverything = useCallback(() => {
    turnRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    cancelSpeech()
  }, [])

  const submit = useCallback(
    async (raw: string) => {
      const question = raw.trim()
      if (!question) {
        setState('idle')
        return
      }

      stopEverything()
      const turn = turnRef.current
      const controller = new AbortController()
      abortRef.current = controller

      const history = trimHistory(historyRef.current)
      const assistantId = nextId.current + 1
      setError('')
      setPartial('')
      setMessages((m) => [
        ...m,
        { id: nextId.current, role: 'user', text: question },
        { id: assistantId, role: 'assistant', text: '' },
      ])
      nextId.current += 2
      setState('thinking')

      const current = () => turnRef.current === turn
      let answer = ''
      let buffer = ''
      const pending: Promise<void>[] = []

      const speak = (sentences: string[]) => {
        if (mutedRef.current || sentences.length === 0) return
        if (current()) setState('speaking')
        pending.push(speakSentences(sentences, false))
      }

      const patch = (changes: Partial<Message>) =>
        setMessages((all) => all.map((m) => (m.id === assistantId ? { ...m, ...changes } : m)))

      const finish = async (refused: boolean) => {
        patch({ refused })
        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ]
        await Promise.all(pending)
        if (current()) setState('idle')
      }

      await sendChat(
        question,
        history,
        {
          onToken: (text) => {
            if (!current()) return
            answer += text
            buffer += text
            patch({ text: answer })
            const { sentences, rest } = pullSentences(buffer)
            buffer = rest
            speak(sentences.map((s) => s.trim()).filter(Boolean))
          },
          onDone: async (refused) => {
            if (!current()) return
            const tail = buffer.trim()
            buffer = ''
            if (tail) speak([tail])
            await finish(refused)
          },
          onRefusal: async (text) => {
            if (!current()) return
            answer = text
            patch({ text })
            speak([text.trim()])
            await finish(true)
          },
          onError: (message) => {
            if (!current()) return
            setError(message)
            setMessages((all) =>
              all.filter((m) => !(m.id === assistantId && m.text === '')),
            )
            setState('idle')
          },
        },
        controller.signal,
      )
    },
    [stopEverything],
  )

  const toggleMic = () => {
    if (state === 'listening') {
      recognizerRef.current?.stop()
      return
    }
    if (!supported) {
      setError('Voice input needs Chrome. You can still type your question below.')
      return
    }
    stopEverything()
    setError('')
    setPartial('')

    const rec = createRecognizer(
      (text) => setPartial(text),
      (text) => {
        recognizerRef.current = null
        setPartial('')
        void submit(text)
      },
      (message) => {
        recognizerRef.current = null
        setPartial('')
        setError(message)
        setState('idle')
      },
    )
    if (!rec) {
      setError('Speech recognition is not available in this browser.')
      return
    }
    recognizerRef.current = rec
    try {
      rec.start()
      setState('listening')
    } catch {
      recognizerRef.current = null
      setError('Could not start the microphone.')
    }
  }

  const onTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = typed.trim()
    if (!text) return
    recognizerRef.current?.abort()
    recognizerRef.current = null
    setTyped('')
    void submit(text)
  }

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const next = await uploadFaq(file)
      stopEverything()
      recognizerRef.current?.abort()
      recognizerRef.current = null
      historyRef.current = []
      setMessages([])
      setPartial('')
      setFaq(next)
      setState('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const hasLog = messages.length > 0 || partial !== ''
  const busy = state === 'thinking'

  return (
    <div className="desk">
      <header className="brand">
        <h1 className="wordmark">
          Echo<span>FAQ</span>
        </h1>
        <p className="tagline">
          Voice answers from your own FAQ.
          {faq ? ` Using ${faq.filename}.` : ''}
        </p>
      </header>

      <main className="stage">
        {!supported && (
          <p className="banner" role="note">
            Voice features work best in Chrome. Speech input or playback isn’t available here —
            you can still type your questions.
          </p>
        )}
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className={`orb${state === 'idle' ? '' : ` ${state}`}`}
          aria-label="Microphone"
          aria-pressed={state === 'listening'}
          onClick={toggleMic}
        >
          <span className="orb-ring" aria-hidden="true" />
          <span className="orb-ring r2" aria-hidden="true" />
          <span className="orb-core" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </span>
        </button>
        <p className="status" role="status">{STATUS[state]}</p>
      </main>

      <section className={`ribbon${hasLog ? ' has-log' : ''}`} aria-label="Transcript">
        <span className="ribbon-label">Transcript</span>
        {hasLog ? (
          <div className="log" ref={logRef}>
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.role === 'assistant' && m.refused !== undefined && (
                  <span className={`tag${m.refused ? ' refused' : ''}`}>
                    {m.refused ? 'Not in FAQ' : 'From FAQ'}
                  </span>
                )}
                <p>{m.text || (m.role === 'assistant' ? '…' : '')}</p>
              </div>
            ))}
            {partial && (
              <div className="bubble user partial">
                <p>{partial}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="ribbon-empty">Your conversation will trace across here.</p>
        )}
      </section>

      <nav className="rail" aria-label="Utilities">
        <button
          type="button"
          className={`rail-btn${muted ? ' on' : ''}`}
          aria-pressed={muted}
          onClick={() => setMuted((m) => !m)}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          hidden
          onChange={onUpload}
        />
        <button
          type="button"
          className="rail-btn"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload FAQ'}
        </button>
        <form className="rail-type" onSubmit={onTypedSubmit}>
          <input
            type="text"
            placeholder="Or type a question…"
            aria-label="Type a question"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="rail-btn go" disabled={busy || !typed.trim()}>
            Send
          </button>
        </form>
      </nav>
    </div>
  )
}
