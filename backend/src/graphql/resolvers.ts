import { GraphQLError } from 'graphql';
import type { AuthUser } from '../auth.js';
import { authenticate, registerPatient } from '../commands/auth.js';
import { cancelOrder } from '../commands/orderLifecycle.js';
import { placeOrder } from '../commands/placeOrder.js';
import type { Context } from '../context.js';
import { getFacets, searchMedications, type Medication } from '../queries/catalog.js';
import { getOrderView, listOrderViews, type OrderView } from '../queries/orders.js';
import { ORDER_CHANGED, withFilter, type OrderChangedMessage, pubsub } from '../pubsub.js';
import { createLoaders } from './loaders.js';
import { DateScalar, DateTime, Money, UUID } from './scalars.js';

function requireUser(ctx: Context): AuthUser {
  if (!ctx.user) {
    throw new GraphQLError('Debes iniciar sesión para realizar esta operación', {
      extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
    });
  }
  return ctx.user;
}

export const resolvers = {
  UUID,
  Date: DateScalar,
  DateTime,
  Money,

  // ───────────── Lado de LECTURA: solo consultan el read model (qry.*) ─────────────
  Query: {
    me: (_: unknown, __: unknown, ctx: Context) => ctx.user,

    medications: (_: unknown, args: any) => searchMedications(args),

    medication: (_: unknown, { id }: { id: string }, ctx: Context) => {
      const numeric = Number(id);
      return Number.isInteger(numeric) ? ctx.loaders.medicationById.load(numeric) : null;
    },

    catalogFacets: (_: unknown, { filter }: { filter?: any }) => getFacets(filter),

    order: (_: unknown, { id }: { id: string }, ctx: Context) => getOrderView(requireUser(ctx).id, id),

    myOrders: (_: unknown, { first, after }: { first?: number; after?: string }, ctx: Context) =>
      listOrderViews(requireUser(ctx).id, first, after),
  },

  // ───────────── Lado de ESCRITURA: cada mutation delega en un comando de dominio ─────────────
  Mutation: {
    register: (_: unknown, { input }: { input: unknown }) => registerPatient(input),
    login: (_: unknown, { input }: { input: unknown }) => authenticate(input),
    placeOrder: (_: unknown, { input }: { input: unknown }, ctx: Context) => placeOrder(requireUser(ctx), input),
    cancelOrder: (_: unknown, { input }: { input: unknown }, ctx: Context) => cancelOrder(requireUser(ctx), input),
  },

  Subscription: {
    orderStatusChanged: {
      subscribe: (root: unknown, args: { orderId: string }, ctx: Context, info: any) => {
        requireUser(ctx);
        // Solo el dueño de la orden recibe sus eventos.
        return withFilter(
          () => pubsub.asyncIterator<OrderChangedMessage>(ORDER_CHANGED),
          (payload: OrderChangedMessage, variables: { orderId: string }, context: Context) =>
            payload.orderId === variables.orderId && payload.userId === context.user?.id,
        )(root, args, ctx, info);
      },
      resolve: async (payload: OrderChangedMessage, _args: unknown, ctx: Context) => {
        // El contexto de una suscripción vive todo el socket: se renuevan los loaders en cada evento
        // para que sus cachés por-request no sirvan datos viejos.
        ctx.loaders = createLoaders();
        const order = await getOrderView(payload.userId, payload.orderId);
        if (!order) throw new GraphQLError('La proyección de la orden no está disponible');
        return order;
      },
    },
  },

  // ───────────── Resolvers anidados: TODOS pasan por DataLoader (sin N+1) ─────────────
  Medication: {
    category: (m: Medication, _: unknown, ctx: Context) => ctx.loaders.categoryById.load(m.categoryId),
    laboratory: (m: Medication, _: unknown, ctx: Context) => ctx.loaders.laboratoryById.load(m.laboratoryId),
  },

  CategoryFacet: {
    category: (f: { categoryId: number }, _: unknown, ctx: Context) => ctx.loaders.categoryById.load(f.categoryId),
  },

  Order: {
    items: (o: OrderView, _: unknown, ctx: Context) => ctx.loaders.itemsByOrderId.load(o.id),
    prescription: (o: OrderView, _: unknown, ctx: Context) =>
      o.requiresPrescription ? ctx.loaders.prescriptionByOrderId.load(o.id) : null,
    statusHistory: (o: OrderView, _: unknown, ctx: Context) => ctx.loaders.historyByOrderId.load(o.id),
  },

  OrderItem: {
    medicationId: (i: { medicationId: number }) => String(i.medicationId),
    medication: (i: { medicationId: number }, _: unknown, ctx: Context) => ctx.loaders.medicationById.load(i.medicationId),
  },
};
