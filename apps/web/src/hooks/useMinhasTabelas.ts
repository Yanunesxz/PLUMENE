import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../services/api.js';
import type { ApiResponse, PriceTable } from '@csb/shared';

export interface MinhasTabelas {
  tabelas: PriceTable[];
  /** Com duas ou mais, a escolha vira obrigatória — e visível. */
  precisaEscolher: boolean;
  /** O nome, para os avisos. `null` quando a tabela não é do conjunto. */
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
 */
export function useMinhasTabelas(): MinhasTabelas {
  const { token } = useAuthStore();
  const [tabelas, setTabelas] = useState<PriceTable[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    api
      .getLista<ApiResponse<PriceTable[]>>('/price-tables/minhas', token)
      .then((res) => {
        if (vivo) setTabelas(res.data);
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

  return {
    tabelas,
    precisaEscolher: tabelas.length >= 2,
    nomeDe: (id) => tabelas.find((t) => t.id === id)?.name ?? null,
    carregando,
  };
}
