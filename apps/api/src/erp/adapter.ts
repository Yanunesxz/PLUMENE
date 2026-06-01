/**
 * Interface e implementações do ERP Adapter.
 *
 * - MockErpAdapter: dados fixos para testes / desenvolvimento sem ERP
 * - FirebirdErpAdapter: conecta ao Firebird real via TCP
 *
 * Seleção feita via variável ERP_SYNC_ENABLED.
 */
import type { Product, Customer, Order } from '@csb/shared';

// ─── Interface ────────────────────────────────────────────────────────────────
export interface ErpAdapter {
  sendOrder(order: Order): Promise<{ erp_order_id: string }>;
  getProducts(company_id: string): Promise<Product[]>;
  getCustomers(company_id: string): Promise<Customer[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

// ─── Mock ─────────────────────────────────────────────────────────────────────
export class MockErpAdapter implements ErpAdapter {
  async sendOrder(order: Order): Promise<{ erp_order_id: string }> {
    // Simula um ID ERP retornado após envio
    return { erp_order_id: `ERP-MOCK-${order.id.slice(0, 8).toUpperCase()}` };
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
  async sendOrder(order: Order): Promise<{ erp_order_id: string }> {
    /**
     * TODO (fase 2): implementar escrita de pedido no Firebird.
     * Por enquanto retorna ID fictício e loga para auditoria.
     * O ERP é somente-leitura nesta versão MVP.
     */
    console.warn('[FirebirdErpAdapter] sendOrder — escrita no ERP não implementada ainda');
    return { erp_order_id: `ERP-${order.id.slice(0, 8).toUpperCase()}` };
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
