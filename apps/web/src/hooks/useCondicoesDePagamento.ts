import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db.js';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../services/api.js';
import type { ApiResponse, PaymentCondition } from '@csb/shared';

/**
 * As condições de pagamento do Control, para o seletor do pedido.
 *
 * Lê do cache offline (Dexie) e atualiza por trás quando há rede — o mesmo
 * desenho do catálogo: o representante em campo escolhe a condição com a lista
 * da última vez que esteve online. Lista vazia = migração 028 ainda não rodou
 * (ou primeiro acesso offline); a tela esconde o seletor em vez de quebrar.
 */
export function useCondicoesDePagamento(): PaymentCondition[] {
  const { token } = useAuthStore();

  const condicoes = useLiveQuery(
    () => db.payment_conditions.orderBy('code').toArray(),
    [],
  );

  useEffect(() => {
    if (!token) return;
    api
      .getLista<ApiResponse<PaymentCondition[]>>('/payment-conditions', token)
      .then(async (res) => {
        // bulkPut, nunca clear+put: se a resposta vier vazia (028 pendente no
        // servidor), o cache que o representante já tem continua valendo.
        if (res.data.length > 0) await db.payment_conditions.bulkPut(res.data);
      })
      .catch(() => {
        // Offline ou erro: fica o cache. O seletor segue com a última lista.
      });
  }, [token]);

  return condicoes ?? [];
}
