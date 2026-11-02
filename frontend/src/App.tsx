import { useEffect, useRef, useState } from 'react';
import { useChat } from './hooks/useChat';
import { Composer } from './components/Composer';
import { PolicyBar } from './components/PolicyBar';
import { TurnView } from './components/TurnView';

// The chat page: policy picker in the header, the conversation, and a fixed composer.
// Members have one standing plan and country (like their account profile), so those live
// outside the conversation as header state, not message features.

export function App() {
  const [planCode, setPlanCode] = useState('GOLD');
  const [jurisdiction, setJurisdiction] = useState('FR');
  const { turns, send, pending, cancel, reset } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const suggestions = ['Am I covered for emergency treatment abroad?', 'What needs pre-authorisation?', 'What are my waiting periods?'];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img className="brand-logo" src="/policybridge-logo.svg" alt="" />
          <div><strong>PolicyBridge</strong><span>Your AI-powered insurance companion.</span></div>
        </div>
        <button type="button" className="new-chat-button" onClick={reset} disabled={pending}>
          <span aria-hidden="true">＋</span> New conversation
        </button>
        <div className="sidebar-label">Recent conversations</div>
        <nav className="history-list" aria-label="Conversation history">
          {turns.length === 0 ? <p className="history-empty">Your conversations will appear here.</p> : turns.map(turn => (
            <button type="button" className="history-item" key={turn.id} onClick={() => document.getElementById(`turn-${turn.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
              <span className="history-dot" aria-hidden="true" />
              <span>{turn.question}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="secure-dot" /> Policy-grounded answers</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><img className="brand-logo small" src="/policybridge-logo.svg" alt="" /><strong>PolicyBridge</strong></div>
          <div className="topbar-title"><span className="eyebrow">PERSONAL COVERAGE</span><h1>AI Insurance Assistant</h1></div>
          <PolicyBar planCode={planCode} jurisdiction={jurisdiction} onPlanChange={setPlanCode} onJurisdictionChange={setJurisdiction} />
        </header>

        <main className="conversation" aria-live="polite">
          {turns.length === 0 && (
            <div className="welcome-state">
              <div className="welcome-icon" aria-hidden="true">✦</div>
              <p className="eyebrow">YOUR POLICY, MADE CLEAR</p>
              <h2>How can I help with your coverage?</h2>
              <p className="welcome-copy">Ask a question about your policy and get a clear answer grounded in your plan documents.</p>
              <div className="suggestion-grid">
                {suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => void send(suggestion, { planCode, jurisdiction })}>{suggestion}<span aria-hidden="true">→</span></button>)}
              </div>
              <div className="trust-note"><span className="secure-dot" /> Answers are checked against your policy before they reach you.</div>
            </div>
          )}
          {turns.map(turn => <div id={`turn-${turn.id}`} key={turn.id}><TurnView turn={turn} onCancel={cancel} /></div>)}
          <div ref={endRef} />
        </main>

        <div className="composer-dock">
          <Composer disabled={pending} onSubmit={question => void send(question, { planCode, jurisdiction })} />
          <p className="composer-hint">AI can make mistakes. Check your policy documents for important decisions.</p>
        </div>
      </section>
    </div>
  );
}
