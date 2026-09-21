-- ════════════════════════════════════════════════════════════════════
-- 001 · LADO DE COMANDOS (write model)
-- Schema "cmd": fuente de verdad transaccional. Solo lo escriben los comandos.
-- Los schemas cmd/qry NO están expuestos por la Data API (PostgREST) de Supabase,
-- que por defecto solo publica "public": no se abre ningún canal REST a estos datos.
-- ════════════════════════════════════════════════════════════════════
SET LOCAL search_path TO public, extensions;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS cmd;
CREATE SCHEMA IF NOT EXISTS qry;

CREATE TABLE cmd.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name     text        NOT NULL,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Agregado de inventario: stock, precio y bandera de fórmula son la fuente de verdad.
CREATE TABLE cmd.medications (
  id                    integer PRIMARY KEY,
  sku                   text          NOT NULL UNIQUE,
  name                  text          NOT NULL,
  active_ingredient     text          NOT NULL,
  category              text          NOT NULL,
  dosage                text          NOT NULL,
  presentation          text          NOT NULL,
  price                 numeric(12,2) NOT NULL CHECK (price >= 0),
  stock                 integer       NOT NULL CHECK (stock >= 0),   -- última línea de defensa: nunca stock negativo
  requires_prescription boolean       NOT NULL,
  manufacturer          text          NOT NULL,
  description           text          NOT NULL,
  version               integer       NOT NULL DEFAULT 1,
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- Agregado de orden
CREATE TABLE cmd.orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid          NOT NULL REFERENCES cmd.users(id),
  status                text          NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','DISPATCHED','CANCELLED')),
  total                 numeric(12,2) NOT NULL CHECK (total >= 0),
  requires_prescription boolean       NOT NULL,
  cancel_reason         text,
  idempotency_key       text,
  transition_due_at     timestamptz,                 -- cuándo el worker de fulfillment debe mover la orden
  version               integer       NOT NULL DEFAULT 1,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_idempotency_uq ON cmd.orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX orders_due_idx ON cmd.orders (transition_due_at) WHERE status IN ('PENDING_APPROVAL','APPROVED');
CREATE INDEX orders_user_idx ON cmd.orders (user_id, created_at DESC);

CREATE TABLE cmd.order_items (
  order_id        uuid          NOT NULL REFERENCES cmd.orders(id) ON DELETE CASCADE,
  medication_id   integer       NOT NULL REFERENCES cmd.medications(id),
  medication_name text          NOT NULL,             -- snapshot al momento de la compra
  quantity        integer       NOT NULL CHECK (quantity > 0),
  unit_price      numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (order_id, medication_id)
);

CREATE TABLE cmd.prescriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid        NOT NULL UNIQUE REFERENCES cmd.orders(id) ON DELETE CASCADE,
  prescription_number text        NOT NULL,
  doctor_name         text        NOT NULL,
  doctor_license      text        NOT NULL,
  issued_at           date        NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Outbox transaccional: los eventos se escriben en la MISMA transacción que el cambio de estado
-- y el proyector los consume después (consistencia eventual sin dual-write).
CREATE TABLE cmd.outbox_events (
  id             bigserial PRIMARY KEY,
  aggregate_type text        NOT NULL,
  aggregate_id   text        NOT NULL,
  event_type     text        NOT NULL,
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);
CREATE INDEX outbox_pending_idx ON cmd.outbox_events (id) WHERE processed_at IS NULL;
