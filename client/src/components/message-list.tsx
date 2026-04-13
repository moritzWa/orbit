import { useEffect, useRef } from 'react';
import type { Message } from '@/types';

function localTime(dateStr: string | null): string {
  if (!dateStr) return '';
  // Dates are stored as UTC without Z suffix - append Z so browser parses as UTC
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface MessageListProps {
  messages: Message[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView();
    }
  }, [loading]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5">
      {messages.map((m, i) =>
        m.source === 'call' || m.source === 'manual' ? (
          <div key={i} className="flex justify-center">
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs ${
                m.source === 'manual'
                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                  : 'bg-muted/50 border-border text-muted-foreground'
              }`}
            >
              <span>{m.text}</span>
              <span className="opacity-60">{localTime(m.date)}</span>
            </div>
          </div>
        ) : (
          <div
            key={i}
            className={`flex ${m.is_from_me ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                m.is_from_me
                  ? 'bg-indigo-600 text-white'
                  : 'bg-muted text-foreground'
              }`}
            >
              <span>{m.text || '(attachment)'}</span>
              <span className="block text-[10px] opacity-60 mt-0.5">
                {localTime(m.date)} · {m.source}
              </span>
            </div>
          </div>
        )
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
