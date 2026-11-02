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
  const { turns, send, pending, cancel } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="rounded-none bg-slate-900 px-4 py-4 text-white shadow-lg sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Insurance Policy Assistant</h1>
              <p className="text-xs text-slate-300">Answers grounded in your policy documents, with citations.</p>
            </div>
            <PolicyBar
              planCode={planCode}
              jurisdiction={jurisdiction}
              onPlanChange={setPlanCode}
              onJurisdictionChange={setJurisdiction}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
        {turns.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-sm text-slate-600">
              Ask a question about your {planCode} {jurisdiction} policy — for example emergency treatment
              abroad, pre-authorisation for planned surgery, or waiting periods.
            </p>
          </div>
        )}
        {turns.map(turn => (
          <TurnView key={turn.id} turn={turn} onCancel={cancel} />
        ))}
        <div ref={endRef} />
      </main>

      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-4 sm:px-6">
        <Composer disabled={pending} onSubmit={question => void send(question, { planCode, jurisdiction })} />
      </div>
    </div>
  );
}
