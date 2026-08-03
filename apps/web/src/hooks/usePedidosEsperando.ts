import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db.js';

/**
 * Quantos pedidos estão parados esperando decisão de quem está logado.
 *
 * Serve para o número no menu. Sem ele, o pedido que a loja montou fica
 * esperando alguém ter a ideia de abrir a tela — e o representante em campo não
 * tem motivo nenhum para abrir "Minha área" no meio do dia.
 *
 * Lê do cache local (Dexie), então o número aparece mesmo offline e não custa
 * uma requisição a cada troca de tela.
 */
export function usePedidosEsperando(): { triagem: number; aprovacao: number } {
  const contagens = useLiveQuery(async () => {
    const [triagem, aprovacao] = await Promise.all([
      db.orders.where('status').equals('pending_rep').count(),
      db.orders.where('status').equals('pending_approval').count(),
    ]);
    return { triagem, aprovacao };
  }, []);

  return contagens ?? { triagem: 0, aprovacao: 0 };
}
