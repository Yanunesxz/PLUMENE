import * as XLSX from 'xlsx';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { OrderWithItems } from '@csb/shared';

function orderSheetRows(orders: OrderWithItems[], customerName: Map<string, string>) {
  return orders.flatMap((order) =>
    order.items.map((item) => ({
      'Nº Pedido': order.order_number ?? order.id.slice(0, 8),
      Cliente: customerName.get(order.customer_id) ?? order.customer_id,
      Status: ORDER_STATUS_LABELS[order.status],
      Produto: item.product_id,
      Variante: item.variant_id ?? '',
      Quantidade: item.quantity,
      'Preço Unit.': item.unit_price,
      Total: item.total,
      'Criado em': new Date(order.created_at).toLocaleDateString('pt-BR'),
    })),
  );
}

export function exportOrdersToXlsx(orders: OrderWithItems[], customerName: Map<string, string>): void {
  const rows = orderSheetRows(orders, customerName);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Pedidos');

  const filename = `pedidos_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
