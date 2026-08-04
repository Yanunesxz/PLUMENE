import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { db } from '../../offline/db.js';
import { Button } from '../../components/interface/Button.js';
import { SeletorDeTabela } from '../../components/comercial/SeletorDeTabela.js';
import { ConfirmarTabela } from '../../components/comercial/ConfirmarTabela.js';
import type { ApiResponse, CustomerListItem, PriceTable } from '@csb/shared';

interface Props {
  cliente: CustomerListItem;
  tabelas: PriceTable[];
  /** `null` quando a tabela atual não é do conjunto de quem está logado. */
  nomeDe: (id: string | null | undefined) => string | null;
  onTrocado: (cliente: CustomerListItem) => void;
  onErro: (mensagem: string) => void;
  onFechar: () => void;
}

/**
 * Trocar a tabela de um cliente que já existe.
 *
 * Os 1.353 clientes vieram do ERP já com tabela, então na prática este é o
 * caminho mais usado — e o mais caro de errar: muda o preço de tudo que a loja
 * comprar dali para frente, inclusive pelo login próprio dela. Daí os dois
 * avisos, iguais aos do cadastro: o bloco amarelo aqui, a confirmação nomeando
 * a tabela por cima.
 */
export function TrocarTabelaDoCliente({
  cliente,
  tabelas,
  nomeDe,
  onTrocado,
  onErro,
  onFechar,
}: Props) {
  const { token } = useAuthStore();
  const [escolhida, setEscolhida] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const atual = nomeDe(cliente.price_table_id);
  const nova = nomeDe(escolhida) ?? '';
  const loja = cliente.trade_name?.trim() || cliente.name;

  const salvar = async () => {
    if (!token || !escolhida) return;
    setSalvando(true);
    try {
      const res = await api.patch<ApiResponse<CustomerListItem>>(
        `/customers/${cliente.id}`,
        { price_table_id: escolhida },
        token,
      );
      await db.customers.put(res.data);
      onTrocado(res.data);
      onFechar();
    } catch (e) {
      onErro(e instanceof Error ? e.message : 'Não foi possível trocar a tabela.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden />
        <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-foreground">{loja}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {cliente.price_table_id
                  ? // Sem o nome quando a tabela é de fora do conjunto: ver a
                    // tabela da região vizinha é ver informação que não é dele.
                    `Hoje compra na ${atual ?? 'outra tabela'}`
                  : 'Ainda sem tabela de preço'}
              </p>
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

          <SeletorDeTabela
            tabelas={tabelas}
            valor={escolhida}
            onEscolher={setEscolhida}
            contexto="cliente"
          />

          <div className="mt-4 flex justify-end">
            <Button disabled={!escolhida} onClick={() => setConfirmando(true)}>
              Trocar a tabela
            </Button>
          </div>
        </div>
      </div>

      {confirmando && (
        <ConfirmarTabela
          titulo={`Mudar o preço de ${loja} para ${nova}?`}
          detalhe={
            cliente.price_table_id
              ? `Hoje esta loja compra na ${atual ?? 'outra tabela'}. A mudança vale para os próximos pedidos, inclusive os que ela mesma fizer pelo login dela.`
              : 'A partir de agora esta loja compra por esta tabela, inclusive nos pedidos que ela mesma fizer pelo login dela.'
          }
          tabela={nova}
          ocupado={salvando}
          onConfirmar={() => void salvar()}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </>
  );
}
