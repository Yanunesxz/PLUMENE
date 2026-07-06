import { useState, useRef, useEffect, type FormEvent, type ReactNode } from 'react';
import { Sparkles, Send, User } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { cn } from '../../lib/utils.js';
import type { ApiResponse } from '@csb/shared';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface AssistantReply {
  reply: string;
  provider: 'mock' | 'fable-5';
}

const SUGESTOES = [
  'Qual o preço da 0015?',
  'Quanto tem de estoque da 0070?',
  'Resumo dos meus pedidos',
  'Buscar cliente',
];

// Render leve: *negrito* e quebras de linha (o assistente responde nesse formato).
function renderReply(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block">
      {line.split(/(\*[^*]+\*)/g).map((seg, j) =>
        seg.startsWith('*') && seg.endsWith('*') ? (
          <strong key={j} className="font-semibold">
            {seg.slice(1, -1)}
          </strong>
        ) : (
          seg
        ),
      )}
    </span>
  ));
}

export function PaginaAssistente() {
  const { token, user } = useAuthStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending || !token) return;
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await api.post<ApiResponse<AssistantReply>>('/assistant', { message }, token);
      setMessages((m) => [...m, { role: 'assistant', text: res.data.reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: err instanceof Error ? err.message : 'Erro ao falar com o assistente.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const empty = messages.length === 0;

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col md:h-[calc(100dvh-4rem)]">
      <div className="border-b border-border px-4 py-3 md:px-6">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
          <Sparkles className="h-5 w-5 text-brand-600" strokeWidth={2.2} />
          Assistente
        </h1>
        <p className="text-xs text-muted-foreground">
          Versão de testes · consulta estoque, preço, clientes e seus pedidos
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {empty ? (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
              <Sparkles className="h-7 w-7" strokeWidth={1.8} />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Como posso ajudar?</p>
              <p className="text-sm text-muted-foreground">Toque numa sugestão ou digite sua pergunta.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-300 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn('flex gap-2.5', m.role === 'user' ? 'flex-row-reverse' : '')}>
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700',
                )}
              >
                {m.role === 'user' ? (
                  <User className="h-4 w-4" strokeWidth={2.2} />
                ) : (
                  <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                )}
              </span>
              <div
                className={cn(
                  'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'rounded-tr-sm bg-brand-600 text-white'
                    : 'rounded-tl-sm bg-muted text-foreground',
                )}
              >
                {renderReply(m.text)}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <div className="flex items-center rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
              <Spinner />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-border p-3 md:px-6">
        <div className="flex items-end gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Pergunte algo, ${user?.name?.split(' ')[0] ?? ''}…`}
            className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Enviar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            <Send className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      </form>
    </div>
  );
}
