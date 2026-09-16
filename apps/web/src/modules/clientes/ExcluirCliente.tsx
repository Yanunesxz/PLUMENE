import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Search, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api, esquecerCache } from '../../services/api.js';
import { db } from '../../offline/db.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import {
  avisoDaExclusao,
  candidatosAFicar,
  frasesDosVinculos,
  totalDeVinculos,
} from '../../lib/exclusaoDeCliente.js';
import { formatarDocumento, apenasDigitos } from '@csb/shared';
import type {
  ApiResponse,
  ClienteExcluido,
  CustomerDetail,
  CustomerListItem,
  ExcluirClienteRequest,
  VinculosParaExcluir,
} from '@csb/shared';

interface Props {
  cliente: CustomerDetail;
  /** Recebe o aviso pronto para a lista de clientes mostrar. */
  onExcluido: (aviso: string) => void;
  onFechar: () => void;
}

/**
 * Excluir cliente — só admin (a API recusa os outros com 403).
 *
 * O caso de uso é o cadastro em dobro. Por isso, havendo pedido, login de
 * loja, convite, vitrine ou tarefa, o diálogo exige o cadastro que FICA com
 * tudo — de preferência outro cliente com o mesmo documento. Só quando não há
 * nenhum ele deixa procurar por nome ou CNPJ.
 *
 * Duas etapas, como a troca de tabela: escolher, depois confirmar nomeando o
 * cliente. A saída fácil (fechar, cancelar) é a segura.
 */
export function ExcluirCliente({ cliente, onExcluido, onFechar }: Props) {
  const { token } = useAuthStore();
  const nome = cliente.trade_name?.trim() || cliente.name;
  const documento = apenasDigitos(cliente.cnpj);

  const [vinculos, setVinculos] = useState<VinculosParaExcluir | null>(null);
  const [erroDaLeitura, setErroDaLeitura] = useState('');
  const [mesmoDocumento, setMesmoDocumento] = useState<CustomerListItem[] | null>(null);

  const [termo, setTermo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<CustomerListItem[] | null>(null);

  const [escolhido, setEscolhido] = useState<CustomerListItem | null>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!token) return;
    setErroDaLeitura('');
    try {
      const [v, iguais] = await Promise.all([
        api.get<ApiResponse<VinculosParaExcluir>>(`/customers/${cliente.id}/vinculos`, token),
        documento
          ? api.get<ApiResponse<CustomerListItem[]>>(`/customers?cnpj=${encodeURIComponent(documento)}`, token)
          : Promise.resolve({ data: [] as CustomerListItem[] }),
      ]);
      setVinculos(v.data);
      setMesmoDocumento(candidatosAFicar(iguais.data, cliente.id, documento || null));
    } catch (e) {
      setErroDaLeitura(e instanceof Error ? e.message : 'Não foi possível ler os vínculos do cliente.');
    }
  }, [token, cliente.id, documento]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const buscar = async () => {
    const t = termo.trim();
    if (!token || t.length < 2 || buscando) return;
    setBuscando(true);
    try {
      const res = await api.get<ApiResponse<CustomerListItem[]>>(`/customers?search=${encodeURIComponent(t)}`, token);
      setResultados(candidatosAFicar(res.data, cliente.id).slice(0, 20));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível buscar na carteira.');
    } finally {
      setBuscando(false);
    }
  };

  const excluir = async () => {
    if (!token || excluindo) return;
    setExcluindo(true);
    setErro('');
    try {
      const corpo: ExcluirClienteRequest = {
        ...(escolhido ? { juntar_em: escolhido.id } : {}),
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      };
      const res = await api.post<ApiResponse<ClienteExcluido>>(`/customers/${cliente.id}/excluir`, corpo, token);
      // A lista, a Minha Área e os pedidos leem o cache do aparelho: sem isto o
      // cliente apagado continuaria aparecendo até a próxima sincronização.
      await db.customers.delete(cliente.id).catch(() => {});
      esquecerCache('/customers');
      onExcluido(avisoDaExclusao(nome, res.data, escolhido ? escolhido.trade_name?.trim() || escolhido.name : null));
    } catch (e) {
      const codigo = (e as Error & { code?: string }).code;
      setErro(e instanceof Error ? e.message : 'Não foi possível excluir o cliente.');
      setConfirmando(false);
      // Alguém criou um vínculo no meio: as contagens da tela ficaram velhas.
      if (codigo === 'CLIENTE_COM_VINCULOS') void carregar();
    } finally {
      setExcluindo(false);
    }
  };

  const total = vinculos ? totalDeVinculos(vinculos.contagens) : 0;
  const precisaJuntar = total > 0;
  const podeExcluir = !!vinculos && !vinculos.migracao_pendente && (!precisaJuntar || !!escolhido);
  const opcoes = mesmoDocumento && mesmoDocumento.length > 0 ? mesmoDocumento : resultados;
  const nomeDe = (c: CustomerListItem) => c.trade_name?.trim() || c.name;

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Excluir ${nome}`}>
        <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden />
        <div className="animate-slide-up relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-danger">Excluir cliente</p>
              <p className="truncate text-[15px] font-semibold text-foreground">{nome}</p>
              {cliente.cnpj && <p className="text-xs text-muted-foreground">{formatarDocumento(cliente.cnpj)}</p>}
            </div>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {erroDaLeitura ? (
            <div className="space-y-3">
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erroDaLeitura}</p>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => void carregar()}>
                  Tentar de novo
                </Button>
              </div>
            </div>
          ) : !vinculos ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> Conferindo o que está ligado a este cliente…
            </div>
          ) : vinculos.migracao_pendente ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-soft-foreground">
              Excluir cliente ainda não está disponível: falta aplicar a migração 050 no banco. Nada foi alterado.
            </p>
          ) : (
            <div className="space-y-4">
              {precisaJuntar ? (
                <div className="rounded-lg bg-sunken p-3 text-sm">
                  <p className="font-medium text-foreground">Este cliente tem {frasesDosVinculos(vinculos.contagens).join(', ')}.</p>
                  <p className="mt-1 text-muted-foreground">
                    Nada disso é apagado: tudo passa para o cadastro que fica. Login de loja que sobrar é desligado, não apagado.
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-sunken p-3 text-sm text-muted-foreground">
                  Nenhum pedido, login de loja, convite, vitrine ou tarefa ligado a este cliente.
                </p>
              )}

              {cliente.erp_id && (
                <p className="text-xs text-warn-soft-foreground">
                  Este cadastro tem código no Control ({cliente.erp_id}). Se ele continuar no Control, a próxima
                  sincronização pode trazê-lo de volta.
                </p>
              )}

              {precisaJuntar && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Qual cadastro fica?</p>

                  {mesmoDocumento && mesmoDocumento.length > 0 ? (
                    <p className="mb-2 text-xs text-muted-foreground">Outros clientes com o mesmo documento:</p>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        Nenhum outro cliente com o mesmo documento. Procure o cadastro que fica por nome ou CNPJ.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void buscar();
                        }}
                        className="mb-2 flex gap-2"
                      >
                        <input
                          value={termo}
                          onChange={(e) => setTermo(e.target.value)}
                          placeholder="Nome ou CNPJ"
                          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                          aria-label="Procurar o cadastro que fica"
                        />
                        <Button type="submit" variant="outline" size="sm" disabled={buscando || termo.trim().length < 2}>
                          {buscando ? <Spinner /> : <Search className="h-4 w-4" />}
                          Buscar
                        </Button>
                      </form>
                    </>
                  )}

                  {opcoes && opcoes.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
                  )}
                  {opcoes && opcoes.length > 0 && (
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                      {opcoes.map((c) => (
                        <li key={c.id}>
                          <label
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${
                              escolhido?.id === c.id ? 'border-primary bg-primary-soft/40' : 'border-border'
                            }`}
                          >
                            <input
                              type="radio"
                              name="cadastro-que-fica"
                              className="mt-0.5"
                              checked={escolhido?.id === c.id}
                              onChange={() => setEscolhido(c)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">{nomeDe(c)}</span>
                              <span className="block text-xs text-muted-foreground">
                                {[c.cnpj ? formatarDocumento(c.cnpj) : null, c.erp_id ? `código ${c.erp_id}` : 'sem código no Control']
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Motivo (opcional) — ex.: cadastro em dobro"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                aria-label="Motivo da exclusão"
              />

              {erro && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={onFechar}>
                  Cancelar
                </Button>
                <Button variant="destructive" disabled={!podeExcluir} onClick={() => setConfirmando(true)}>
                  {precisaJuntar ? 'Excluir e juntar' : 'Excluir cliente'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmando && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Confirmar exclusão de ${nome}`}>
          <div className="absolute inset-0 bg-foreground/40" onClick={() => !excluindo && setConfirmando(false)} aria-hidden />
          <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-danger bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground">
                <AlertTriangle className="h-5 w-5" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-snug text-foreground">Excluir {nome}?</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {escolhido
                    ? `Tudo o que é deste cliente passa para ${nomeDe(escolhido)}, e o cadastro de ${nome} sai da carteira.`
                    : `O cadastro de ${nome} sai da carteira.`}{' '}
                  Uma cópia fica guardada, mas não dá para desfazer pela tela.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setConfirmando(false)} disabled={excluindo}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={() => void excluir()} disabled={excluindo}>
                {excluindo ? (
                  <>
                    <Spinner />
                    Excluindo…
                  </>
                ) : (
                  'Sim, excluir'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
