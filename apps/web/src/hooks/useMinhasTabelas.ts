import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../services/api.js';
import { rotuloDaTabela, tabelasEscolhiveis, type ApiResponse, type PriceTable } from '@csb/shared';

export interface MinhasTabelas {
  /**
   * As tabelas que dá para ESCOLHER: só as ativas no Control. É o que vai para
   * todo seletor (cadastro, troca de tabela, consulta do catálogo).
   */
  tabelas: PriceTable[];
  /**
   * O conjunto inteiro, com as desligadas no Control (`active: false`). Para
   * reconhecer a tabela que um cliente ou pedido JÁ usa — o número da planilha
   * da fábrica, a tabela do próprio catálogo. Nunca para oferecer escolha.
   */
  todas: PriceTable[];
  /** Com duas ou mais ATIVAS, a escolha vira obrigatória — e visível. */
  precisaEscolher: boolean;
  /**
   * O nome, para os avisos. `null` quando a tabela não é do conjunto. Tabela
   * desligada no Control continua com nome — marcado "(inativa no Control)":
   * o cliente que está nela segue comprando por ela.
   */
  nomeDe: (id: string | null | undefined) => string | null;
  carregando: boolean;
}

/**
 * As tabelas de preço que ESTE usuário pode atribuir.
 *
 * A rota já devolve só o conjunto dele: quem tem uma tabela só recebe uma e
 * nunca fica sabendo que existem outras. Saber o preço da região vizinha é
 * informação comercial que não pertence ao representante — por isso `nomeDe`
 * devolve `null` para tabela de fora, e a tela mostra "outra tabela" sem nome.
 *
 * Pede as inativas junto (`incluir_inativas=1`) e separa aqui: a escolha fica
 * só com as ativas, e o nome das inativas continua aparecendo onde um cliente
 * ou pedido ainda as usa.
 */
export function useMinhasTabelas(): MinhasTabelas {
  const { token } = useAuthStore();
  const [todas, setTodas] = useState<PriceTable[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    api
      .getLista<ApiResponse<PriceTable[]>>('/price-tables/minhas?incluir_inativas=1', token)
      .then((res) => {
        if (vivo) setTodas(res.data);
      })
      .catch(() => {
        // Offline: sem o conjunto não dá para escolher com segurança. A tela
        // trata isso bloqueando o botão, não adivinhando uma tabela.
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  // Memorizado: as telas usam a lista como dependência de efeito e de memo, e
  // um array novo a cada render as faria recalcular à toa.
  const tabelas = useMemo(() => tabelasEscolhiveis(todas), [todas]);

  return {
    tabelas,
    todas,
    precisaEscolher: tabelas.length >= 2,
    nomeDe: (id) => {
      const tabela = id ? todas.find((t) => t.id === id) : undefined;
      return tabela ? rotuloDaTabela(tabela) : null;
    },
    carregando,
  };
}
