import { useState } from 'react';
import { Bell, Send } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Textarea } from '../../components/interface/Textarea.js';
import { Select } from '../../components/interface/Select.js';
import { Button } from '../../components/interface/Button.js';
import type { ApiResponse } from '@csb/shared';

/**
 * "Enviar aviso" — a promoção que chega no celular (a tela do PDF do Fábio,
 * sem o WhatsApp pago no meio).
 *
 * Enviar para muita gente é irreversível, então o botão pede a segunda
 * confirmação nomeando o público — sem popup, o próprio botão vira a pergunta.
 */

type Publico = 'todos' | 'reps' | 'lojas' | 'lojas_compraram';

const PUBLICOS: Array<{ valor: Publico; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todo mundo com o app' },
  { valor: 'reps', rotulo: 'Só os representantes' },
  { valor: 'lojas', rotulo: 'Só as lojas' },
  { valor: 'lojas_compraram', rotulo: 'Lojas que compraram nos últimos 90 dias' },
];

const DESTINOS = [
  { valor: '/catalog', rotulo: 'Abre o catálogo' },
  { valor: '/orders', rotulo: 'Abre os pedidos' },
  { valor: '/', rotulo: 'Abre a tela inicial' },
];

export function EnviarAviso() {
  const { token } = useAuthStore();
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [publico, setPublico] = useState<Publico>('todos');
  const [destino, setDestino] = useState('/catalog');
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pronto = titulo.trim().length >= 2 && mensagem.trim().length >= 2;
  const rotuloDoPublico = PUBLICOS.find((p) => p.valor === publico)?.rotulo ?? '';

  const enviar = async () => {
    if (!token || enviando) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await api.post<ApiResponse<{ pessoas: number; aparelhos: number }>>(
        '/push/enviar',
        { title: titulo.trim(), body: mensagem.trim(), url: destino, publico },
        token,
      );
      const { pessoas, aparelhos } = res.data;
      setResultado(
        aparelhos > 0
          ? `Aviso enviado: ${aparelhos} aparelho(s), de ${pessoas} pessoa(s) no público.`
          : `Ninguém do público (${pessoas} pessoa(s)) ativou os avisos ainda — nada foi entregue.`,
      );
      setTitulo('');
      setMensagem('');
      setConfirmando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o aviso.');
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Enviar aviso
      </h2>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Chega como notificação no celular de quem ativou os avisos — promoção, coleção nova,
          recado geral. Sem custo por mensagem.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="aviso-titulo" className="text-sm font-medium text-foreground">
              Título
            </label>
            <Input
              id="aviso-titulo"
              value={titulo}
              maxLength={80}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Promoção de pijamas ❄️"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="aviso-msg" className="text-sm font-medium text-foreground">
              Mensagem
            </label>
            <Textarea
              id="aviso-msg"
              value={mensagem}
              maxLength={200}
              rows={2}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Ex.: Pijamas selecionados com 20% de desconto até sexta. Toque para ver."
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="aviso-publico" className="text-sm font-medium text-foreground">
              Para quem
            </label>
            <Select
              id="aviso-publico"
              value={publico}
              onChange={(e) => {
                setPublico(e.target.value as Publico);
                setConfirmando(false);
              }}
            >
              {PUBLICOS.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="aviso-destino" className="text-sm font-medium text-foreground">
              O toque
            </label>
            <Select id="aviso-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              {DESTINOS.map((d) => (
                <option key={d.valor} value={d.valor}>
                  {d.rotulo}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {erro && (
          <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
            {erro}
          </p>
        )}
        {resultado && (
          <p className="mt-3 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-soft-foreground">
            {resultado}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          {confirmando ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={enviando} onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
              <Button disabled={enviando} onClick={() => void enviar()}>
                <Send className="h-4 w-4" strokeWidth={2.5} />
                {enviando ? 'Enviando…' : `Confirmar: ${rotuloDoPublico}`}
              </Button>
            </div>
          ) : (
            <Button disabled={!pronto} onClick={() => setConfirmando(true)}>
              <Bell className="h-4 w-4" strokeWidth={2.5} />
              Enviar aviso
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
