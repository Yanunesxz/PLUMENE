import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Pedido em montagem (carrinho). Persistido para não se perder ao trocar de
// tela ou recarregar — é a fonte única usada pelo Catálogo e pela tela de
// Novo Pedido.

export interface CartItem {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
}

interface CartState {
  items: CartItem[];
  add: (item: CartItem) => void;
  setQuantity: (product_id: string, quantity: number) => void;
  setUnitPrice: (product_id: string, unit_price: number) => void;
  remove: (product_id: string) => void;
  clear: () => void;
  has: (product_id: string) => boolean;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (item) =>
        set((s) =>
          s.items.some((i) => i.product_id === item.product_id)
            ? { items: s.items.filter((i) => i.product_id !== item.product_id) } // toggle: remove se já estiver
            : { items: [...s.items, { ...item, quantity: Math.max(1, item.quantity) }] },
        ),

      setQuantity: (product_id, quantity) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.product_id === product_id ? { ...i, quantity: Math.max(1, quantity || 1) } : i,
          ),
        })),

      setUnitPrice: (product_id, unit_price) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.product_id === product_id ? { ...i, unit_price: Math.max(0, unit_price) } : i,
          ),
        })),

      remove: (product_id) =>
        set((s) => ({ items: s.items.filter((i) => i.product_id !== product_id) })),

      clear: () => set({ items: [] }),

      has: (product_id) => get().items.some((i) => i.product_id === product_id),
    }),
    { name: 'csb-cart' },
  ),
);
