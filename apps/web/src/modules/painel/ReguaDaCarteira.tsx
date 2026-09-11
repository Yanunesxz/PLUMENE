import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { reguaDaCarteira, definirReguaDaCarteira } from '../../lib/carteira.js';
import type { ApiResponse, ReguaDaCarteira as Regua } from '@csb/shared';

/**
 * "Régua da carteira" — quantos dias sem comprar pintam o cliente de amarelo
 * e de vermelho.
 *
 * Pedido do Yan (11/09/2026): "hoje temos os limites de clientes ativos,
 * inativos, e atenção mas a lista esta com 90 180 ou 180+ quero que o admin
 * possa mudar isso manualmente". Era número escrito no código; agora é da
 * fábrica (migração 043), e muda sem deploy.
 *
 * Só o admin. A mudança vale na hora, para todo mundo — é a mesma régua que
 * pinta o selo do cliente na tela do representante.
 */
export function ReguaDaCarteira() {
  const { token } = useAuthStore();
  const atual = reguaDaCarteira();
  const [atencao, setAtencao] = useState(String(atual.atencao));
  const [esfriado, setEsfriado] = useState(String(atual.esfriado));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  const a = Number(atencao);
  const e = Number(esfriado);
  const numerosBons = Number.isInteger(a) && Number.isInteger(e) && a >= 1 && e > a && e <= 3650;
  const mudou = a !== atual.atencao || e !== atual.esfriado;

  const salvar = async () => {
    if (!token || !numerosBons || salvando) return;
    setSalvando(true);
    setErro(null);
    setSalvo(null);
    try {
      const res = await api.patch<ApiResponse<Regua>>('/company/carteira', { atencao: a, esfriado: e }, token);
      definirReguaDaCarteira(res.data);
      setAtencao(String(res.data.atencao));
      setEsfriado(String(res.data.esfriado));
      setSalvo(
        `Pronto. Amarelo a partir de ${res.data.atencao} dias, vermelho a partir de ${res.data.esfriado}.`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a régua.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Régua da carteira
      </h2>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Os dias sem comprar que acendem cada cor na lista de Clientes. Vale na hora, para todo
          mundo — inclusive no celular do representante.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="regua-atencao" className="text-sm font-medium text-foreground">
              Vira <span className="text-warn-soft-foreground">atenção</span> com
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="regua-atencao"
                inputMode="numeric"
                value={atencao}
                onChange={(ev) => setAtencao(ev.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">dias sem comprar</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="regua-esfriado" className="text-sm font-medium text-foreground">
              Vira <span className="text-danger">esfriado</span> com
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="regua-esfriado"
                inputMode="numeric"
                value={esfriado}
                onChange={(ev) => setEsfriado(ev.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">dias sem comprar</span>
            </div>
          </div>
        </div>

        {/* O que os dois números fazem, em português — quem mexe aqui precisa
            ver a consequência antes de salvar, não depois. */}
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-positive align-middle" />
            Ativo: comprou nos últimos {numerosBons ? a : atual.atencao} dias.
          </li>
          <li>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warn align-middle" />
            Atenção: de {numerosBons ? a : atual.atencao} a {numerosBons ? e : atual.esfriado} dias
            sem comprar.
          </li>
          <li>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger align-middle" />
            Esfriado: {numerosBons ? e : atual.esfriado} dias ou mais — e aí o representante tem de
            registrar o motivo.
          </li>
        </ul>

        {!numerosBons && (atencao !== '' || esfriado !== '') && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-soft-foreground">
            O prazo do vermelho tem de ser maior que o do amarelo — senão a faixa de atenção some e
            o cliente pula de verde para vermelho sem ninguém ser avisado.
          </p>
        )}
        {erro && (
          <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
            {erro}
          </p>
        )}
        {salvo && (
          <p className="mt-3 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-soft-foreground">
            {salvo}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <Button disabled={!numerosBons || !mudou || salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar a régua'}
          </Button>
        </div>
      </div>
    </section>
  );
}
