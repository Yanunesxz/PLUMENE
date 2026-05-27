import type { Product, Customer, Order } from '@csb/shared';

export interface ErpAdapter {
  sendOrder(order: Order): Promise<{ erp_order_id: string }>;
  getProducts(company_id: string): Promise<Product[]>;
  getCustomers(company_id: string): Promise<Customer[]>;
}

export class MockErpAdapter implements ErpAdapter {
  async sendOrder(order: Order): Promise<{ erp_order_id: string }> {
    return { erp_order_id: `ERP-${order.id.slice(0, 8).toUpperCase()}` };
  }

  async getProducts(_company_id: string): Promise<Product[]> {
    return [];
  }

  async getCustomers(_company_id: string): Promise<Customer[]> {
    return [];
  }
}

export const erpAdapter: ErpAdapter = new MockErpAdapter();
