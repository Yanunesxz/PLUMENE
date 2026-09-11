import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, Send, X } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Textarea } from '../../components/interface/Textarea.js';
import { Select } from '../../components/interface/Select.js';
import { Button } from '../../components/interface/Button.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { apenasDigitos, formatarDocumento } from '@csb/shared';
import type { ApiResponse } from '@csb/shared';

/**
 * "Enviar aviso" — a promoção que chega no celular (a tela do PDF do Fábio,
 * sem o WhatsApp pago no meio).
 *
 * Enviar para muita gente é irreversível, então o botão pede a segunda
 * confirmação nomeando o público — sem popup, o próprio botão vira a pergunta.
 *
 * Desde 11/09/2026 também dá para escolher os clientes NA MÃO, por CPF/CNPJ
 * (pedido do Yan): útil para a promoção de um estado, de uma rede, ou para os
 * dez lojistas que pediram a coleção nova.
 */

type Publico = 'todos' | 'reps' | 'lojas' | 'lojas_compraram' | 'escritorio' | 'clientes';

const PUBLICOS: Array<{ valor: Publico; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todo mundo com o app' },
  { valor: 'reps', rotulo: 'Só os representantes' },
  { valor: 'lojas', rotulo: 'Só as lojas' },
  { valor: 'lojas_compraram', rotulo: 'Lojas que compraram nos últimos 90 dias' },
  { valor: 'escritorio', rotulo: 'Só gerência comercial e financeiro' },
  { valor: 'clientes', rotulo: 'Clientes que eu escolher (por CNPJ)' },
];

const DESTINOS = [
  { valor: '/catalog', rotulo: 'Abre o catálogo' },
  { valor: '/orders', rotulo: 'Abre os pedidos' },
  { valor: '/', rotulo: 'Abre a tela inicial' },
];

interface Escolhido {
  /** Só dígitos — é o que a API procura. */
  documento: string;
  /** O nome que o app conhece, ou vazio quando o CNPJ veio de fora da lista. */
  nome: string;
}

/** Um documento por linha, ou colados com vírgula/ponto e vírgula. */
function lerDocumentosColados(texto: string): string[] {
  return texto
    .split(/[\n,;]+/)
    .map(apenasDigitos)
    .filter((d) => d.length === 11 || d.length === 14);
}

export function EnviarAviso() {
  const { token } = useAuthStore();
  const clientes = useLiveQuery(() => db.customers.toArray(), []);
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [publico, setPublico] = useState<Publico>('todos');
  const [destino, setDestino] = useState('/catalog');
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // ─── A lista escolhida na mão ──────────────────────────────────────────────
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);
  const [colados, setColados] = useState('');
  const [avisoDaLista, setAvisoDaLista] = useState<string | null>(null);

  const porDocumento = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes ?? []) {
      const d = apenasDigitos(c.cnpj ?? '');
      if (d) m.set(d, c.trade_name?.trim() || c.name);
    }
    return m;
  }, [clientes]);

  const opcoesDeCliente = useMemo(
    () =>
      (clientes ?? [])
        .filter((c) => apenasDigitos(c.cnpj ?? '').length >= 11)
        .map((c) => ({
          value: apenasDigitos(c.cnpj ?? ''),
          label: c.trade_name?.trim() || c.name,
          sublabel: formatarDocumento(apenasDigitos(c.cnpj ?? '')),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientes],
  );

  const juntar = (documentos: string[]): number => {
    let novos = 0;
    setEscolhidos((atuais) => {
      const jaTem = new Set(atuais.map((e) => e.documento));
      const lista = [...atuais];
      for (const d of documentos) {
        if (jaTem.has(d)) continue;
        jaTem.add(d);
        lista.push({ documento: d, nome: porDocumento.get(d) ?? '' });
        novos++;
      }
      return lista;
    });
    setConfirmando(false);
    return novos;
  };

  const adicionarColados = () => {
    const documentos = lerDocumentosColados(colados);
    if (documentos.length === 0) {
      setAvisoDaLista('Nenhum CPF ou CNPJ completo nessa lista — são 11 ou 14 números cada.');
      return;
    }
    juntar(documentos);
    // Quem não está na lista do app pode ser cliente de outro representante
    // ainda não baixado neste aparelho — a API é que dá a palavra final, então
    // o documento entra do mesmo jeito, só avisado.
    const desconhecidos = documentos.filter((d) => !porDocumento.has(d));
    setAvisoDaLista(
      desconhecidos.length > 0
        ? `${documentos.length} documento(s) na lista — ${desconhecidos.length} não estão nos clientes deste aparelho. O servidor confere no envio.`
        : null,
    );
    setColados('');
  };

  const pronto =
    titulo.trim().length >= 2 &&
    mensagem.trim().length >= 2 &&
    (publico !== 'clientes' || escolhidos.length > 0);

  const rotuloDoPublico =
    publico === 'clientes'
      ? `${escolhidos.length} cliente${escolhidos.length === 1 ? '' : 's'} escolhido${escolhidos.length === 1 ? '' : 's'}`
      : (PUBLICOS.find((p) => p.valor === publico)?.rotulo ?? '');

  const enviar = async () => {
    if (!token || enviando) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await api.post<
        ApiResponse<{
          pessoas: number;
          aparelhos: number;
          naoEncontrados?: string[];
          clientesSemConta?: number;
        }>
      >(
        '/push/enviar',
        {
          title: titulo.trim(),
          body: mensagem.trim(),
          url: destino,
          publico,
          ...(publico === 'clientes' ? { documentos: escolhidos.map((e) => e.documento) } : {}),
        },
        token,
      );
      const { pessoas, aparelhos, naoEncontrados, clientesSemConta } = res.data;
      // O que NÃO chegou vai escrito junto: aviso que some sem avisar é o
      // pior desfecho possível de uma campanha.
      const sobras = [
        naoEncontrados && naoEncontrados.length > 0
          ? `${naoEncontrados.length} documento(s) sem cliente: ${naoEncontrados.slice(0, 5).map(formatarDocumento).join(', ')}${naoEncontrados.length > 5 ? '…' : ''}`
          : null,
        clientesSemConta ? `${clientesSemConta} cliente(s) ainda sem conta no app` : null,
      ].filter(Boolean);
      setResultado(
        (aparelhos > 0
          ? `Aviso enviado: ${aparelhos} aparelho(s), de ${pessoas} pessoa(s) no público.`
          : `Ninguém do público (${pessoas} pessoa(s)) ativou os avisos ainda — nada foi entregue.`) +
          (sobras.length > 0 ? ` ${sobras.join('. ')}.` : ''),
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

        {publico === 'clientes' && (
          <div className="mt-3 rounded-lg border border-dashed border-border p-3">
            <p className="text-xs text-muted-foreground">
              Escolha um a um pelo nome, ou cole a lista de CNPJ (um por linha). O aviso vai só
              para as contas de loja desses clientes.
            </p>

            <div className="mt-2.5 space-y-2">
              <SearchSelect
                id="aviso-cliente"
                options={opcoesDeCliente}
                onSelect={(doc) => {
                  juntar([doc]);
                  setAvisoDaLista(null);
                }}
                resetOnSelect
                placeholder="Buscar um cliente…"
                searchPlaceholder="Nome ou CNPJ…"
                emptyText="Nenhum cliente com esse nome"
              />
              <Textarea
                value={colados}
                rows={2}
                onChange={(e) => setColados(e.target.value)}
                placeholder="Ou cole aqui: 22.518.613/0001-58, 11222333000181…"
              />
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" disabled={!colados.trim()} onClick={adicionarColados}>
                  Adicionar a lista
                </Button>
                {escolhidos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setEscolhidos([]);
                      setAvisoDaLista(null);
                      setConfirmando(false);
                    }}
                    className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
                  >
                    Limpar os {escolhidos.length}
                  </button>
                )}
              </div>
            </div>

            {avisoDaLista && (
              <p className="mt-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn-soft-foreground">
                {avisoDaLista}
              </p>
            )}

            {escolhidos.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {escolhidos.map((e) => (
                  <li
                    key={e.documento}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    <span className="max-w-[16rem] truncate">
                      {e.nome || formatarDocumento(e.documento)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Tirar ${e.nome || e.documento} da lista`}
                      onClick={() => {
                        setEscolhidos((atuais) => atuais.filter((x) => x.documento !== e.documento));
                        setConfirmando(false);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
