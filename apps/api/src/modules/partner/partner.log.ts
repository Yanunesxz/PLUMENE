import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';

/**
 * REGISTRO DE CADA CHAMADA DO PARCEIRO (migração 048, A).
 *
 * Até aqui a única memória de uma chamada do Control era o log do Fastify no
 * Railway, que some em dias e não diz o que foi gravado. Quando o Fábio
 * perguntar "mandei o faturamento das 14h, por que o pedido não virou?", a
 * resposta tem de estar no banco: rota, status HTTP, quantos chegaram, quantos
 * gravaram, quantos ficaram iguais, quantos foram ignorados e por quê.
 *
 * Três regras:
 *   1. NUNCA derruba a chamada. O registro é acessório: sem a 048, com o banco
 *      recusando o insert ou com qualquer exceção, a resposta ao parceiro sai
 *      igual e o problema fica só no console.
 *   2. `detalhe` leva só códigos, posições, motivos e contagens. Nome, CNPJ,
 *      e-mail, telefone, endereço e valor não entram — e o que escapar é
 *      removido aqui (ver `limparDetalhe`).
 *   3. Nada da chave de API. Chamada 401/503 grava com company_id e parceiro
 *      nulos.
 */

export interface ChamadaDoParceiro {
  /** Empresa da chave. `null` só em chamada sem chave válida (401/503). */
  company_id: string | null;
  /** Nome do parceiro dono da chave. `null` junto com company_id. */
  parceiro: string | null;
  /** O PADRÃO da rota ('/partner/v1/pedidos/:id/confirmar'), não a URL com o id. */
  rota: string;
  metodo: string;
  http_status: number;
  recebidos?: number | null | undefined;
  gravados?: number | null | undefined;
  sem_mudanca?: number | null | undefined;
  ignorados?: number | null | undefined;
  /** Só códigos, posições, motivos e contagens. */
  detalhe?: Record<string, unknown> | null | undefined;
  /** Quando a requisição chegou (ISO com fuso). Ausente = agora. */
  started_at?: string | null | undefined;
}

/** Chaves que carregam dado de cliente ou valor: nunca vão para o `detalhe`. */
const CHAVE_PROIBIDA =
  /nome|name|razao|fantasia|trade|cnpj|cpf|documento|e_?mail|whats|telefone|fone|phone|celular|endereco|address|logradouro|cep|bairro|cidade|inscricao|observa|nota_?chave|^chave$|valor|preco|price|total|senha|password|token|api_?key|x-api-key/i;

/** Exceções que a regra acima pegaria sem querer: não são dado de cliente. */
const CHAVE_PERMITIDA = new Set(['valor_atual']);

/** E-mail, CNPJ e CPF escritos dentro de um texto (motivo com mensagem do banco, por exemplo). */
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

const MAX_TEXTO = 300;
const MAX_LISTA = 200;
const MAX_PROFUNDIDADE = 5;

function limparTexto(s: string): string {
  const limpo = s.replace(EMAIL, '[removido]').replace(CNPJ, '[removido]').replace(CPF, '[removido]');
  return limpo.length > MAX_TEXTO ? `${limpo.slice(0, MAX_TEXTO)}…` : limpo;
}

/**
 * O `detalhe` como pode ser guardado: tira chaves de dado pessoal ou valor,
 * mascara e-mail/CNPJ/CPF dentro dos textos e corta o que for grande demais.
 * Exportada para teste.
 */
export function limparDetalhe(v: unknown, profundidade = 0): unknown {
  if (v == null) return null;
  if (typeof v === 'string') return limparTexto(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (profundidade >= MAX_PROFUNDIDADE) return null;
  if (Array.isArray(v)) {
    const itens = v.slice(0, MAX_LISTA).map((x) => limparDetalhe(x, profundidade + 1));
    if (v.length > MAX_LISTA) itens.push(`… mais ${v.length - MAX_LISTA}`);
    return itens;
  }
  if (typeof v === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(v as Record<string, unknown>)) {
      if (CHAVE_PROIBIDA.test(chave) && !CHAVE_PERMITIDA.has(chave)) continue;
      saida[chave] = limparDetalhe(valor, profundidade + 1);
    }
    return saida;
  }
  return null;
}

/** Contagem que vai para coluna INTEGER: inteiro não negativo, ou null. */
function contagem(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.trunc(v));
}

/**
 * Grava uma linha em `erp_sync_log`. Nunca lança.
 *
 * `true` quando gravou; `false` quando não gravou (sem a 048, ou o banco
 * recusou) — só para teste e diagnóstico, quem chama não precisa olhar.
 */
export async function registrarChamada(chamada: ChamadaDoParceiro): Promise<boolean> {
  try {
    if (!(await detectar('erp_sync_log', 'rota'))) return false;

    const agora = new Date().toISOString();
    const gravados = contagem(chamada.gravados);
    const status = Math.trunc(Number(chamada.http_status));
    const detalhe = chamada.detalhe == null ? null : limparDetalhe(chamada.detalhe);

    const { error } = await supabase.from('erp_sync_log').insert({
      company_id: chamada.company_id ?? null,
      sync_type: 'parceiro',
      status: status > 0 && status < 400 ? 'success' : 'error',
      started_at: chamada.started_at ?? agora,
      finished_at: agora,
      records_synced: gravados ?? 0,
      parceiro: chamada.parceiro ?? null,
      // Sem query string: o `desde` e o `incluir` não identificam a rota.
      rota: String(chamada.rota ?? '').split('?')[0] ?? '',
      metodo: String(chamada.metodo ?? '').toUpperCase(),
      http_status: Number.isFinite(status) ? status : null,
      recebidos: contagem(chamada.recebidos),
      gravados,
      sem_mudanca: contagem(chamada.sem_mudanca),
      ignorados: contagem(chamada.ignorados),
      detalhe,
      created_at: agora,
      updated_at: agora,
    });
    if (error) {
      console.error(`[parceiro] falha ao registrar a chamada ${chamada.metodo} ${chamada.rota}: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[parceiro] falha ao registrar a chamada ${chamada.metodo} ${chamada.rota}: ${msg}`);
    return false;
  }
}
