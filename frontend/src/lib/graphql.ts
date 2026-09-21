import { gql } from '@apollo/client';

// Todas las operaciones del cliente viajan por POST /graphql (y ws /graphql para Subscriptions).
// Cada componente pide únicamente los campos que muestra: sin over-fetching.

// ── Lecturas (Query) ─────────────────────────────────────────

/** Vista condensada del catálogo: solo lo necesario para la tarjeta. */
export const CATALOG_LIST = gql`
  query CatalogList($filter: MedicationFilter, $sort: MedicationSort, $first: Int, $after: String) {
    medications(filter: $filter, sort: $sort, first: $first, after: $after) {
      totalCount
      edges {
        cursor
        node {
          id
          name
          activeIngredient
          presentation
          price
          requiresPrescription
          stockStatus
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const CATALOG_FACETS = gql`
  query CatalogFacets($filter: MedicationFilter) {
    catalogFacets(filter: $filter) {
      prescriptionRequired
      overTheCounter
      categories {
        count
        category {
          id
          name
        }
      }
    }
  }
`;

/** Ficha detallada: todos los campos, incluidas relaciones resueltas con DataLoader en el servidor. */
export const MEDICATION_DETAIL = gql`
  query MedicationDetail($id: ID!) {
    medication(id: $id) {
      id
      sku
      name
      activeIngredient
      dosage
      presentation
      price
      description
      requiresPrescription
      stockStatus
      availableStock
      category {
        id
        name
      }
      laboratory {
        id
        name
      }
    }
  }
`;

export const MY_ORDERS = gql`
  query MyOrders($first: Int, $after: String) {
    myOrders(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          status
          total
          itemCount
          requiresPrescription
          placedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ORDER_DETAIL = gql`
  query OrderDetail($id: UUID!) {
    order(id: $id) {
      id
      status
      total
      itemCount
      requiresPrescription
      cancelReason
      placedAt
      updatedAt
      items {
        medicationId
        medicationName
        quantity
        unitPrice
        lineTotal
        medication {
          id
          presentation
        }
      }
      prescription {
        prescriptionNumber
        doctorName
        doctorLicense
        issuedAt
      }
      statusHistory {
        status
        reason
        occurredAt
      }
    }
  }
`;

// ── Comandos (Mutation) ──────────────────────────────────────

export const REGISTER = gql`
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      token
      user {
        id
        email
        fullName
      }
      errors {
        code
        message
        field
      }
    }
  }
`;

export const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      token
      user {
        id
        email
        fullName
      }
      errors {
        code
        message
        field
      }
    }
  }
`;

export const PLACE_ORDER = gql`
  mutation PlaceOrder($input: PlaceOrderInput!) {
    placeOrder(input: $input) {
      receipt {
        orderId
        status
        total
        itemCount
        requiresPrescription
        placedAt
      }
      errors {
        code
        message
        field
        medicationId
        requested
        available
      }
    }
  }
`;

export const CANCEL_ORDER = gql`
  mutation CancelOrder($input: CancelOrderInput!) {
    cancelOrder(input: $input) {
      receipt {
        orderId
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

// ── Tiempo real (Subscription) ───────────────────────────────

/** Devuelve el Order actualizado: el caché normalizado de Apollo lo fusiona por id automáticamente. */
export const ORDER_STATUS_CHANGED = gql`
  subscription OrderStatusChanged($orderId: UUID!) {
    orderStatusChanged(orderId: $orderId) {
      id
      status
      updatedAt
      cancelReason
      statusHistory {
        status
        reason
        occurredAt
      }
    }
  }
`;
