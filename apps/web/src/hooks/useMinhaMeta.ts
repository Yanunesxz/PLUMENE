import { useEffect, useState } from 'react';
import type { ApiResponse, FaixaDeBonus } from '@csb/shared';
import { api } from '../services/api.js';
import { useAuthStore } from '../store/authStore.js';

/**
 * As faixas de bonificação do próprio representante no mês corrente.
 *
 * Fica em localStorage, e não no Dexie: é um punhado de números, e o
 * representante abre a "Minha área" no meio da loja, muitas vezes sem sinal —
 * guardar a última resposta faz a régua aparecer na hora, e a rede só corrige o
 * que mudou. A chave leva o id do usuário para o cache não vazar de uma conta
 * para outra no mesmo aparelho.
 */
const chave = (userId: string) => `csb_meta_${userId}`;

function lerCache(userId: string): FaixaDeBonus[] {
  try {
    const cru = localStorage.getItem(chave(userId));
    const faixas: unknown = cru ? JSON.parse(cru) : null;
    return Array.isArray(faixas) ? (faixas as FaixaDeBonus[]) : [];
  } catch {
    return [];
  }
}

export function useMinhaMeta(): FaixaDeBonus[] {
  const { token, user } = useAuthStore();
  const userId = user?.id ?? '';
  const [faixas, setFaixas] = useState<FaixaDeBonus[]>(() => (userId ? lerCache(userId) : []));

  useEffect(() => {
    if (!token || !userId) return;
    setFaixas(lerCache(userId));
    api
      .get<ApiResponse<FaixaDeBonus[]>>('/minha-meta', token)
      .then((r) => {
        const novas = r.data ?? [];
        setFaixas(novas);
        localStorage.setItem(chave(userId), JSON.stringify(novas));
      })
      // Sem rede fica o que já estava guardado — a régua não pisca nem some.
      .catch(() => {});
  }, [token, userId]);

  return faixas;
}
