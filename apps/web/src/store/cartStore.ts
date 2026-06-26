import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Pedido em montagem (carrinho). Cada linha é (produto × tamanho) — cores são
// sortidas. Persistido para não se perder ao trocar de tela ou recarregar.

export interface CartItem {
  product_id: string;
  variant_id: string | null;
  size: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
}

const sameLine = (a: { product_id: string; size: string }, b: { product_id: string; size: string }) =>
  a.product_id === b.product_id && a.size === b.size;

interface CartState {
  items: CartItem[];
  add: (item: CartItem) => void;
  setQuantity: (product_id: string, size: string, quantity: number) => void;
  setUnitPrice: (product_id: string, size: string, unit_price: number) => void;
  remove: (product_id: string, size: string) => void;
  clear: () => void;
  hasProduct: (product_id: string) => boolean;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (item) =>
        set((s) => {
          const idx = s.items.findIndex((i) => sameLine(i, item));
          if (idx >= 0) {
            const items = s.items.slice();
            const cur = items[idx]!;
            items[idx] = { ...cur, quantity: cur.quantity + Math.max(1, item.quantity) };
            return { items };
          }
          return { items: [...s.items, { ...item, quantity: Math.max(1, item.quantity) }] };
        }),

      setQuantity: (product_id, size, quantity) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.product_id === product_id && i.size === size
              ? { ...i, quantity: Math.max(1, quantity || 1) }
              : i,
          ),
        })),

      setUnitPrice: (product_id, size, unit_price) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.product_id === product_id && i.size === size
              ? { ...i, unit_price: Math.max(0, unit_price) }
              : i,
          ),
        })),

      remove: (product_id, size) =>
        set((s) => ({ items: s.items.filter((i) => !(i.product_id === product_id && i.size === size)) })),

      clear: () => set({ items: [] }),

      hasProduct: (product_id) => get().items.some((i) => i.product_id === product_id),
    }),
    { name: 'csb-cart-v2' },
  ),
);
