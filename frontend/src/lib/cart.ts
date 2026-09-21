import { makeVar } from '@apollo/client';

export interface CartLine {
  medicationId: string;
  name: string;
  presentation: string;
  price: number;
  requiresPrescription: boolean;
  quantity: number;
}

export interface Receipt {
  orderId: string;
  status: string;
  total: number;
  itemCount: number;
  requiresPrescription: boolean;
  placedAt: string;
}

/** Regla espejo del servidor (la validación real vive en el comando PlaceOrder). */
export const MAX_QTY = 10;

const KEY = 'ap.cart';

/** El carrito es estado de cliente (reactive variable); el servidor solo conoce el pedido al emitir el comando. */
export const cartVar = makeVar<CartLine[]>([]);

/** Acuses recibidos de placeOrder: alimentan la vista "sincronizando" mientras la proyección no existe. */
export const receiptsVar = makeVar<Record<string, Receipt>>({});

function commit(lines: CartLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* sin persistencia */
  }
  cartVar(lines);
}

export function loadCart() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) cartVar(JSON.parse(raw) as CartLine[]);
  } catch {
    /* noop */
  }
}

export function addToCart(item: Omit<CartLine, 'quantity'>, quantity = 1) {
  const lines = cartVar();
  const found = lines.find((l) => l.medicationId === item.medicationId);
  if (found) {
    commit(lines.map((l) => (l === found ? { ...l, ...item, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l)));
  } else {
    commit([...lines, { ...item, quantity: Math.min(MAX_QTY, quantity) }]);
  }
}

export function setQuantity(medicationId: string, quantity: number) {
  const q = Math.max(1, Math.min(MAX_QTY, quantity));
  commit(cartVar().map((l) => (l.medicationId === medicationId ? { ...l, quantity: q } : l)));
}

export function removeFromCart(medicationId: string) {
  commit(cartVar().filter((l) => l.medicationId !== medicationId));
}

export function clearCart() {
  commit([]);
}

export const cartUnits = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);
export const cartTotal = (lines: CartLine[]) => lines.reduce((n, l) => n + l.price * l.quantity, 0);
