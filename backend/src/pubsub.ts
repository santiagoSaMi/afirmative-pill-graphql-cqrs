import graphqlSubscriptions from 'graphql-subscriptions';

// graphql-subscriptions es CommonJS: import por defecto = module.exports (interop seguro en ESM).
const { PubSub, withFilter } = graphqlSubscriptions as typeof import('graphql-subscriptions');

/**
 * Bus en memoria (una instancia de API). Para escalar horizontalmente se sustituye por
 * graphql-redis-subscriptions o un canal LISTEN/NOTIFY sin cambiar los resolvers.
 */
export const pubsub = new PubSub();
export { withFilter };

export const ORDER_CHANGED = 'ORDER_CHANGED';
export interface OrderChangedMessage {
  orderId: string;
  userId: string;
}
