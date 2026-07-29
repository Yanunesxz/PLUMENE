import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { OrderWithItems } from '@csb/shared';

function orderSheetRows(
  orders: OrderWithItems[],
  customerName: Map<string, string>,
  productSku: Map<string, string>,
) {
  return orders.flatMap((order) =>
    order.items.map((item) => ({
      'Nº Pedido': order.order_number ?? order.id.slice(0, 8),
      Cliente: customerName.get(order.customer_id) ?? order.customer_id,
      Status: ORDER_STATUS_LABELS[order.status],
      Produto: productSku.get(item.product_id) ?? item.product_id,
      Variante: 'Sortido',
      Quantidade: item.quantity,
      'Preço Unit.': item.unit_price,
      Total: item.total,
      'Criado em': new Date(order.created_at).toLocaleDateString('pt-BR'),
    })),
  );
}

export async function exportOrdersToXlsx(
  orders: OrderWithItems[],
  customerName: Map<string, string>,
  productSku: Map<string, string>,
): Promise<void> {
  // A xlsx sozinha pesa mais que o resto do app. Carregar só quando alguém
  // clica em exportar tira ~430 KB da abertura do catálogo — que é o caminho
  // que o representante faz todo dia, no celular dele.
  const XLSX = await import('xlsx');

  const rows = orderSheetRows(orders, customerName, productSku);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Pedidos');

  const filename = `pedidos_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // iOS Safari (e o app instalado como PWA) ignoram o download por <a download>,
  // então o XLSX.writeFile "não baixa nada" no iPhone. Quando o navegador
  // suporta compartilhar arquivos (iOS 15+), abrimos a folha nativa — o usuário
  // salva em Arquivos ou envia no WhatsApp. No desktop/Android cai no download.
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Pedidos' });
      return;
    } catch (err) {
      // Usuário fechou a folha de compartilhamento: não é erro.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Outra falha: cai para o download por link abaixo.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
