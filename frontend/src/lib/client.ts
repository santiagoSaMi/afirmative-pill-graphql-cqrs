import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, split } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition, relayStylePagination } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import { clearAuth, getToken } from './auth';

const HTTP_URL = process.env.NEXT_PUBLIC_GRAPHQL_HTTP_URL ?? 'http://localhost:4000/graphql';
const WS_URL = process.env.NEXT_PUBLIC_GRAPHQL_WS_URL ?? 'ws://localhost:4000/graphql';

function createCache() {
  return new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // Paginación por cursor: fetchMore concatena páginas en el caché (los filtros forman la clave).
          medications: relayStylePagination(['filter', 'sort']),
          myOrders: relayStylePagination(),
        },
      },
      // Objetos sin identidad propia: se incrustan en su padre.
      OrderItem: { keyFields: false },
      StatusChange: { keyFields: false },
      Prescription: { keyFields: false },
      CatalogFacets: { keyFields: false },
      CategoryFacet: { keyFields: false },
    },
  });
}

let browserClient: ApolloClient<any> | undefined;

/** Un único ApolloClient por pestaña: HTTP para Query/Mutation, WebSocket para Subscription. */
export function getClient(): ApolloClient<any> {
  if (browserClient) return browserClient;

  const authLink = setContext((_, { headers }) => {
    const token = getToken();
    return { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } };
  });

  const errorLink = onError(({ graphQLErrors }) => {
    if (graphQLErrors?.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) clearAuth();
  });

  const httpLink = ApolloLink.from([errorLink, authLink, new HttpLink({ uri: HTTP_URL })]);

  const wsLink = new GraphQLWsLink(
    createClient({
      url: WS_URL,
      lazy: true, // se conecta al primer subscribe y se cierra sin suscripciones activas
      connectionParams: () => {
        const token = getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  );

  const link = split(
    ({ query }) => {
      const def = getMainDefinition(query);
      return def.kind === 'OperationDefinition' && def.operation === 'subscription';
    },
    wsLink,
    httpLink,
  );

  browserClient = new ApolloClient({ link, cache: createCache() });
  return browserClient;
}
