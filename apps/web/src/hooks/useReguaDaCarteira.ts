import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useAuthStore } from '../store/authStore.js';
import { reguaDaCarteira, definirReguaDaCarteira } from '../lib/carteira.js';
import type { ApiResponse, ReguaDaCarteira } from '@csb/shared';

/**
 * Busca a régua da carteira da fábrica (migração 043) e a deixa valendo para
 * o app inteiro.
 *
 * Fica no AppLayout, uma vez por sessão: o selo do cliente aparece em quatro
 * telas diferentes e nenhuma delas pode medir por uma régua própria. Falhou a
 * rede? Vale a última guardada no aparelho — o app offline continua pintando
 * os clientes como pintava ontem, que é melhor do que não pintar.
 */
export function useReguaDaCarteira(): ReguaDaCarteira {
  const { token } = useAuthStore();
  const [regua, setRegua] = useState<ReguaDaCarteira>(reguaDaCarteira);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    api
      .get<ApiResponse<ReguaDaCarteira>>('/company/carteira', token)
      .then((res) => {
        if (!vivo) return;
        definirReguaDaCarteira(res.data);
        setRegua(reguaDaCarteira());
      })
      .catch(() => {
        // Servidor velho (sem a rota) ou celular sem sinal: fica a guardada.
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  return regua;
}
