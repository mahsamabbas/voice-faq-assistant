import { useState } from 'react'

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

const ORDER: OrbState[] = ['idle', 'listening', 'thinking', 'speaking']

const STATUS: Record<OrbState, string> = {
  idle: 'Tap the orb and ask your FAQ anything',
  listening: 'Listening…',
  thinking: 'Finding the answer…',
  speaking: 'Speaking…',
}

export default function App() {
  // UI-shell only: tapping the orb previews each visual state. No speech/API yet.
  const [state, setState] = useState<OrbState>('idle')
  const [muted, setMuted] = useState(false)

  const cycle = () =>
    setState((s) => ORDER[(ORDER.indexOf(s) + 1) % ORDER.length])

  return (
    <div className="desk">
      <header className="brand">
        <h1 className="wordmark">
          Echo<span>FAQ</span>
        </h1>
        <p className="tagline">Voice answers from your own FAQ.</p>
      </header>

      <main className="stage">
        <button
          type="button"
          className={`orb${state === 'idle' ? '' : ` ${state}`}`}
          aria-label="Microphone"
          aria-pressed={state === 'listening'}
          onClick={cycle}
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

      <section className="ribbon" aria-label="Transcript">
        <span className="ribbon-label">Transcript</span>
        <p className="ribbon-empty">Your conversation will trace across here.</p>
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
        <button type="button" className="rail-btn" disabled title="Coming soon">
          Upload FAQ
        </button>
        <form className="rail-type" onSubmit={(e) => e.preventDefault()}>
          <input type="text" placeholder="Or type a question…" aria-label="Type a question" disabled />
          <button type="submit" className="rail-btn go" disabled>Send</button>
        </form>
      </nav>
    </div>
  )
}
