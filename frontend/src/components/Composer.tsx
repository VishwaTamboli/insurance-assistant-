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
      className="composer"
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
        className="composer-input"
      />
      <button
        type="submit"
        disabled={!allows}
        className="send-button"
      >
        <span aria-hidden="true">{disabled ? '◌' : '↑'}</span>{disabled ? 'Checking…' : 'Send'}
      </button>
    </form>
  );
}
