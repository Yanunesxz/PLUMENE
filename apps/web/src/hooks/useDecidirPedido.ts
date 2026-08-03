import { useState } from 'react';
import { db } from '../offline/db.js';
import { api } from '../services/api.js';
import { useAuthStore } from '../store/authStore.js';
import type { ApiResponse, Order, OrderStatus } from '@csb/shared';

/**
 * Decidir um pedido — triagem do representante e aprovação do gerente.
 *
 * As duas telas que decidem (a área do representante e o detalhe do pedido)
 * chamam a mesma coisa, e as duas precisam do cache local atualizado na hora:
 * sem isso o pedido continua aparecendo na fila até a próxima sincronização, e
 * quem decidiu clica de novo achando que não funcionou.
 */
export function useDecidirPedido(aoTerminar?: (mensagem: string, erro: boolean) => void) {
  const { token } = useAuthStore();
  const [decidindo, setDecidindo] = useState<string | null>(null);

  const decidir = async (orderId: string, status: OrderStatus): Promise<boolean> => {
    if (!token || decidindo) return false;

    // Decidir é irreversível e vale para outras pessoas — não entra na fila
    // offline. Sem este aviso, o toque falharia com "erro de rede" e quem
    // decidiu ficaria sem saber se passou ou não.
    if (!navigator.onLine) {
      aoTerminar?.('Você está sem internet. Conecte para decidir o pedido.', true);
      return false;
    }

    setDecidindo(orderId);
    try {
      await api.patch<ApiResponse<Order>>(`/orders/${orderId}/status`, { status }, token);
      await db.orders.update(orderId, { status });
      aoTerminar?.(
        status === 'rejected'
          ? 'Pedido recusado.'
          : status === 'approved'
            ? 'Pedido aprovado!'
            : 'Pedido enviado para a fábrica!',
        status === 'rejected',
      );
      return true;
    } catch (err) {
      aoTerminar?.(err instanceof Error ? err.message : 'Não foi possível decidir agora.', true);
      return false;
    } finally {
      setDecidindo(null);
    }
  };

  return { decidir, decidindo };
}
