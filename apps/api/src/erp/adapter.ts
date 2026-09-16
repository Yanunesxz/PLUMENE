/**
 * Interface e implementações do ERP Adapter.
 *
 * - MockErpAdapter: dados fixos para testes / desenvolvimento sem ERP
 * - FirebirdErpAdapter: conecta ao Firebird real via TCP
 *
 * Seleção feita via variável ERP_SYNC_ENABLED.
 *
 * ENVIO DE PEDIDO DESLIGADO (fase 0 da integração com o Control). Os dois
 * `sendOrder` inventavam um número ('ERP-MOCK-…' / 'ERP-…') sem nada ter entrado
 * no ERP. Número de pedido só existe se veio do Control: pela API de parceiro
 * (`/partner/v1/pedidos/:id/confirmar`), pelo lançamento na tela ou pelo
 * `sync.py --mode push-orders` com o canal 'sync_py'. Aqui agora LANÇA, para
 * nenhum chamador futuro gravar número de mentira em `orders.erp_order_id`.
 */
import type { Product, Customer, Order } from '@csb/shared';

// ─── Interface ────────────────────────────────────────────────────────────────
export interface ErpAdapter {
  sendOrder(order: Order): Promise<{ erp_order_id: string }>;
  getProducts(company_id: string): Promise<Product[]>;
  getCustomers(company_id: string): Promise<Customer[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/** O erro de `sendOrder`: envio de pedido por adaptador não existe. */
export class EnvioAoErpDesligadoError extends Error {
  readonly code = 'ERP_ENVIO_DESLIGADO';
  constructor(adaptador: string) {
    super(
      `${adaptador}.sendOrder está desligado: o número do pedido só vem do Control ` +
        '(API de parceiro, lançamento pela tela ou sync.py com canal sync_py). Nenhum número foi gravado.',
    );
    this.name = 'EnvioAoErpDesligadoError';
  }
}

// ─── Mock ─────────────────────────────────────────────────────────────────────
export class MockErpAdapter implements ErpAdapter {
  async sendOrder(_order: Order): Promise<{ erp_order_id: string }> {
    throw new EnvioAoErpDesligadoError('MockErpAdapter');
  }

  async getProducts(_company_id: string): Promise<Product[]> {
    return [];
  }

  async getCustomers(_company_id: string): Promise<Customer[]> {
    return [];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Mock adapter — sem conexão real com ERP' };
  }
}

// ─── Firebird (real) ──────────────────────────────────────────────────────────
export class FirebirdErpAdapter implements ErpAdapter {
  async sendOrder(_order: Order): Promise<{ erp_order_id: string }> {
    // A escrita no Firebird do Control não é feita pela API. O único caminho
    // que escreve lá é o push-orders do sync.py, travado por canal e por env.
    throw new EnvioAoErpDesligadoError('FirebirdErpAdapter');
  }

  async getProducts(_company_id: string): Promise<Product[]> {
    // A leitura de produtos é feita via ErpSyncService (sync Firebird → Supabase)
    // O catálogo é servido do Supabase, não diretamente do Firebird
    return [];
  }

  async getCustomers(_company_id: string): Promise<Customer[]> {
    return [];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const { testConnection } = await import('./firebird/connection.js');
    return testConnection();
  }
}

// ─── Exporta instância correta ────────────────────────────────────────────────
import { env } from '../config/env.js';

export const erpAdapter: ErpAdapter = env.ERP_SYNC_ENABLED
  ? new FirebirdErpAdapter()
  : new MockErpAdapter();
