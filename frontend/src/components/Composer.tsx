import { useState } from 'react';

// The question box. Enter sends, Shift+Enter inserts a newline, and sending is disabled
// while a request is running (also guarded in the hook, so both layers agree).
interface Props {
  disabled: boolean;
  onSubmit: (question: string) => void;
}

export function Composer({ disabled, onSubmit }: Props) {
  const [draft, setDraft] = useState('');
  const allows = !disabled && draft.trim().length > 0;

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!allows) return;
    onSubmit(draft);
    setDraft('');
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg"
    >
      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about your cover, pre-authorisation or waiting periods…"
        aria-label="Your insurance question"
        className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!allows}
        className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {disabled ? 'Checking…' : 'Ask'}
      </button>
    </form>
  );
}
