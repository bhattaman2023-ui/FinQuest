import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Plus, Trash2, MessageCircle, AlertCircle, BookOpen } from 'lucide-react';
import api from '@/api/client';
import { formatDateTimeIST } from '@/lib/formatters';
import { PageSpinner } from '@/components/ui/PageSpinner';

// ── Types ─────────────────────────────────────────────────────────────
interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ── Markdown-lite renderer (bold, inline code) ─────────────────────────
function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} style={{ background: 'var(--color-bg)', padding: '1px 5px', borderRadius: 3, fontSize: '0.9em' }}>{part.slice(1, -1)}</code>;
    if (part === '\n')
      return <br key={i} />;
    return part;
  });
}

// ── Message bubble ─────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 'var(--space-4)',
    }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: 'var(--color-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, marginRight: 'var(--space-3)', marginTop: 2,
        }}>
          <MessageCircle size={14} style={{ color: '#fff' }} />
        </div>
      )}
      <div style={{
        maxWidth: '72%',
        padding: 'var(--space-3) var(--space-4)',
        background: isUser ? 'var(--color-ink)' : 'var(--color-surface)',
        color: isUser ? '#fff' : 'var(--color-ink)',
        border: isUser ? 'none' : '1px solid var(--color-hairline)',
        borderRadius: isUser ? 'var(--radius-md) var(--radius-md) 2px var(--radius-md)' : 'var(--radius-md) var(--radius-md) var(--radius-md) 2px',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.65,
      }}>
        <div>{renderContent(msg.content)}</div>
        <div style={{ fontSize: 10, color: isUser ? 'rgba(255,255,255,0.5)' : 'var(--color-muted)', marginTop: 'var(--space-1)', textAlign: isUser ? 'right' : 'left' }}>
          {formatDateTimeIST(msg.created_at)}
        </div>
      </div>
    </div>
  );
}

// ── Typing indicator ───────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <MessageCircle size={14} style={{ color: '#fff' }} />
      </div>
      <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', display: 'flex', gap: 5 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: 6, height: 6, background: 'var(--color-muted)', borderRadius: '50%', animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
        <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }`}</style>
      </div>
    </div>
  );
}

// ── Session sidebar item ───────────────────────────────────────────────
function SessionItem({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-3) var(--space-4)',
      background: active ? 'var(--color-sage)' : 'transparent',
      borderBottom: '1px solid var(--color-hairline)',
      cursor: 'pointer',
      transition: 'background var(--transition-fast)',
    }}
      role="button" onClick={onSelect}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 400, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.title}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 2 }}>
          {session.messageCount} msg · {new Date(session.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        aria-label="Delete session"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)', opacity: 0.6, flexShrink: 0 }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Starter prompts ────────────────────────────────────────────────────
const STARTERS = [
  'What is a mutual fund and how does SIP work?',
  'Explain the difference between equity and debt investments.',
  'What is the NIFTY 50 index and how is it calculated?',
  'How does compounding work? Give me a simple example.',
  'What is RSI and how do traders use it?',
  'Can you explain capital gains tax in India?',
];

// ── Main page ──────────────────────────────────────────────────────────
export default function MentorPage() {
  const qc = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Load session list
  const { data: sessions, isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ['mentor-sessions'],
    queryFn: () => api.get('/mentor/sessions').then(r => r.data),
  });

  // Load active session messages
  const { data: activeSession, isLoading: msgLoading } = useQuery({
    queryKey: ['mentor-session', activeSessionId],
    queryFn: () => api.get(`/mentor/sessions/${activeSessionId}`).then(r => r.data),
    enabled: !!activeSessionId,
  });

  // Sync local messages when session loads
  useEffect(() => {
    if (activeSession?.messages) {
      setLocalMessages(activeSession.messages);
    }
  }, [activeSession]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages, isSending]);

  // Delete session
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/mentor/sessions/${id}`).then(r => r.data),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['mentor-sessions'] });
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setLocalMessages([]);
      }
    },
  });

  // Send message
  async function sendMessage(text: string) {
    if (!text.trim() || isSending) return;
    setInput('');
    setIsSending(true);

    // Optimistic UI
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`, role: 'user', content: text,
      created_at: new Date().toISOString(),
    };
    setLocalMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await api.post('/mentor/chat', {
        message: text,
        sessionId: activeSessionId,
      });
      const data = res.data;

      // Update session ID if new
      if (data.sessionId && data.sessionId !== activeSessionId) {
        setActiveSessionId(data.sessionId);
      }

      // Add assistant response
      const assistantMsg: Message = {
        id: `temp-a-${Date.now()}`, role: 'assistant', content: data.response,
        created_at: new Date().toISOString(),
      };
      setLocalMessages(prev => [...prev, assistantMsg]);

      // Refresh sessions list (new session may have appeared)
      qc.invalidateQueries({ queryKey: ['mentor-sessions'] });
      if (activeSessionId) qc.invalidateQueries({ queryKey: ['mentor-session', activeSessionId] });

    } catch {
      setLocalMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: 'Sorry, I could not reach the AI service right now. Please try again.',
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function newChat() {
    setActiveSessionId(null);
    setLocalMessages([]);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function selectSession(id: string) {
    if (id === activeSessionId) return;
    setActiveSessionId(id);
    setLocalMessages([]);
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', maxWidth: 'var(--content-max)', margin: '0 auto', padding: '0 var(--space-6)', gap: 0 }}>
      {/* Sidebar */}
      <div style={{ width: 260, flexShrink: 0, background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Sidebar header */}
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-base)', fontWeight: 500 }}>Conversations</div>
          <button onClick={newChat} title="New chat" style={{ background: 'var(--color-ink)', border: 'none', borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
            <Plus size={12} /> New
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessionsLoading && <div style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>Loading…</div>}
          {sessions?.length === 0 && (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-muted)', fontSize: 'var(--text-sm)' }}>
              No conversations yet. Ask your first question!
            </div>
          )}
          {sessions?.map(s => (
            <SessionItem
              key={s.id} session={s} active={activeSessionId === s.id}
              onSelect={() => selectSession(s.id)}
              onDelete={() => deleteMutation.mutate(s.id)}
            />
          ))}
        </div>

        {/* Disclaimer */}
        <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--color-hairline)', fontSize: 10, color: 'var(--color-muted)', lineHeight: 1.5 }}>
          AI Mentor is for financial education only. Not investment advice. Responses may be incorrect — always verify.
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--color-hairline)', borderLeft: 'none', borderRadius: '0 var(--radius-md) var(--radius-md) 0', background: 'var(--color-bg)', overflow: 'hidden' }}>
        {/* Chat header */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-hairline)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ width: 36, height: 36, background: 'var(--color-ink)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageCircle size={16} style={{ color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-base)', fontWeight: 500 }}>FINQUEST AI Mentor</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Financial literacy guide for Indian investors</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-3)', background: 'rgba(183,121,31,0.08)', border: '1px solid rgba(183,121,31,0.2)', borderRadius: 'var(--radius-pill)', fontSize: 10, color: 'var(--color-accent)', fontWeight: 600 }}>
            <AlertCircle size={10} /> Educational only
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5)' }}>
          {msgLoading && activeSessionId && <PageSpinner />}

          {/* Welcome / starter state */}
          {!activeSessionId && localMessages.length === 0 && (
            <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: 'var(--space-8)' }}>
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
                <div style={{ width: 56, height: 56, background: 'var(--color-ink)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-4)' }}>
                  <MessageCircle size={24} style={{ color: '#fff' }} />
                </div>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>Ask me anything about finance</h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>I'm here to help you understand investing, markets, and financial concepts — in plain language.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                {STARTERS.map(s => (
                  <button key={s} onClick={() => sendMessage(s)} style={{
                    padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--color-ink)', cursor: 'pointer', textAlign: 'left', lineHeight: 1.5,
                    transition: 'border-color var(--transition-fast)', display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                  }}>
                    <BookOpen size={12} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {localMessages.map(msg => <Bubble key={msg.id} msg={msg} />)}
          {isSending && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--color-hairline)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about investing, markets, or personal finance… (Enter to send, Shift+Enter for new line)"
              rows={2}
              style={{
                flex: 1, padding: 'var(--space-3)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)', resize: 'none', fontFamily: 'var(--font-sans)', color: 'var(--color-ink)',
                background: 'var(--color-bg)', lineHeight: 1.5, outline: 'none',
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isSending}
              style={{
                padding: 'var(--space-3)', background: 'var(--color-ink)', border: 'none', borderRadius: 'var(--radius-md)',
                cursor: input.trim() && !isSending ? 'pointer' : 'not-allowed', opacity: input.trim() && !isSending ? 1 : 0.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
              aria-label="Send message"
            >
              <Send size={16} style={{ color: '#fff' }} />
            </button>
          </div>
          <p style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 'var(--space-2)' }}>
            FINQUEST AI Mentor cannot give real investment advice. Prices and market data are simulated. Always consult a SEBI-registered advisor for real financial decisions.
          </p>
        </div>
      </div>
    </div>
  );
}
