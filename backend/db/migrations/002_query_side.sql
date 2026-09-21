-- ════════════════════════════════════════════════════════════════════
-- 002 · LADO DE CONSULTAS (read model / proyecciones)
-- Schema "qry": modelos desnormalizados/optimizados para lectura.
-- Solo el proyector escribe aquí; los resolvers de Query solo leen de aquí.
-- ════════════════════════════════════════════════════════════════════
SET LOCAL search_path TO public, extensions;

CREATE TABLE qry.categories (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

CREATE TABLE qry.laboratories (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE qry.medications (
  id                    integer PRIMARY KEY,
  sku                   text    NOT NULL UNIQUE,
  name                  text    NOT NULL,
  active_ingredient     text    NOT NULL,
  category_id           integer NOT NULL REFERENCES qry.categories(id),
  laboratory_id         integer NOT NULL REFERENCES qry.laboratories(id),
  dosage                text    NOT NULL,
  presentation          text    NOT NULL,
  price                 numeric(12,2) NOT NULL,
  description           text    NOT NULL,
  requires_prescription boolean NOT NULL,
  stock_available       integer NOT NULL,
  stock_status          text    NOT NULL CHECK (stock_status IN ('IN_STOCK','LOW_STOCK','OUT_OF_STOCK')),
  -- texto normalizado (minúsculas, sin tildes) para búsqueda por subcadena
  name_norm             text    NOT NULL,
  ingredient_norm       text    NOT NULL,
  search_text           text    NOT NULL,
  last_event_id         bigint  NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qry_med_category_idx   ON qry.medications (category_id);
CREATE INDEX qry_med_laboratory_idx ON qry.medications (laboratory_id);
CREATE INDEX qry_med_name_idx       ON qry.medications (name, id);           -- keyset pagination por nombre
CREATE INDEX qry_med_price_idx      ON qry.medications (price, id);          -- keyset pagination por precio
CREATE INDEX qry_med_rx_idx         ON qry.medications (requires_prescription);
CREATE INDEX qry_med_search_trgm    ON qry.medications USING gin (search_text gin_trgm_ops);
CREATE INDEX qry_med_name_trgm      ON qry.medications USING gin (name_norm gin_trgm_ops);
CREATE INDEX qry_med_ingr_trgm      ON qry.medications USING gin (ingredient_norm gin_trgm_ops);

CREATE TABLE qry.order_views (
  order_id              uuid PRIMARY KEY,
  user_id               uuid          NOT NULL,
  status                text          NOT NULL,
  total                 numeric(12,2) NOT NULL,
  item_count            integer       NOT NULL,
  requires_prescription boolean       NOT NULL,
  cancel_reason         text,
  placed_at             timestamptz   NOT NULL,
  updated_at            timestamptz   NOT NULL,
  last_event_id         bigint        NOT NULL
);
CREATE INDEX qry_orders_user_idx ON qry.order_views (user_id, placed_at DESC, order_id DESC);

CREATE TABLE qry.order_item_views (
  order_id        uuid    NOT NULL REFERENCES qry.order_views(order_id) ON DELETE CASCADE,
  medication_id   integer NOT NULL,
  medication_name text    NOT NULL,
  quantity        integer NOT NULL,
  unit_price      numeric(12,2) NOT NULL,
  line_total      numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id, medication_id)
);

CREATE TABLE qry.order_status_history (
  order_id    uuid        NOT NULL REFERENCES qry.order_views(order_id) ON DELETE CASCADE,
  status      text        NOT NULL,
  reason      text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (order_id, status)
);

CREATE TABLE qry.prescription_views (
  order_id            uuid PRIMARY KEY REFERENCES qry.order_views(order_id) ON DELETE CASCADE,
  prescription_number text NOT NULL,
  doctor_name         text NOT NULL,
  doctor_license      text NOT NULL,
  issued_at           date NOT NULL
);

-- Defensa en profundidad: RLS activo en todas las tablas (el rol postgres del backend lo omite).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('cmd', 'qry') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;
