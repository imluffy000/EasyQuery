-- Seed the demo "customer" database with realistic, deterministic data.
--
-- Deterministic matters: the agent evaluation suite asserts on actual numbers,
-- so a random seed would make the benchmark unrepeatable. Everything below is
-- generated from fixed arithmetic over generate_series, not random().

\connect demo_analytics

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
    id          int PRIMARY KEY,
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE
);
COMMENT ON TABLE categories IS 'Product categories';

CREATE TABLE IF NOT EXISTS products (
    id            int PRIMARY KEY,
    category_id   int NOT NULL REFERENCES categories(id),
    name          text NOT NULL,
    sku           text NOT NULL UNIQUE,
    unit_price    numeric(10,2) NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL
);
COMMENT ON TABLE products IS 'Sellable products';
COMMENT ON COLUMN products.unit_price IS 'List price in INR';

CREATE TABLE IF NOT EXISTS customers (
    id            int PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    full_name     text NOT NULL,
    phone         text,
    city          text NOT NULL,
    country       text NOT NULL DEFAULT 'India',
    status        text NOT NULL DEFAULT 'active',
    created_at    timestamptz NOT NULL
);
COMMENT ON TABLE customers IS 'Registered customers';
COMMENT ON COLUMN customers.status IS 'active | churned | suspended';

CREATE TABLE IF NOT EXISTS orders (
    id            int PRIMARY KEY,
    customer_id   int NOT NULL REFERENCES customers(id),
    status        text NOT NULL,
    total_amount  numeric(12,2) NOT NULL,
    created_at    timestamptz NOT NULL
);
COMMENT ON TABLE orders IS 'Customer orders';
COMMENT ON COLUMN orders.total_amount IS 'Order gross value in INR';
COMMENT ON COLUMN orders.status IS 'completed | pending | cancelled | refunded';

CREATE TABLE IF NOT EXISTS order_items (
    id          int PRIMARY KEY,
    order_id    int NOT NULL REFERENCES orders(id),
    product_id  int NOT NULL REFERENCES products(id),
    quantity    int NOT NULL,
    unit_price  numeric(10,2) NOT NULL,
    line_total  numeric(12,2) NOT NULL
);
COMMENT ON TABLE order_items IS 'Line items belonging to an order';

CREATE TABLE IF NOT EXISTS payments (
    id          int PRIMARY KEY,
    order_id    int NOT NULL REFERENCES orders(id),
    method      text NOT NULL,
    amount      numeric(12,2) NOT NULL,
    status      text NOT NULL,
    paid_at     timestamptz
);
COMMENT ON TABLE payments IS 'Payments against orders';

CREATE TABLE IF NOT EXISTS subscriptions (
    id            int PRIMARY KEY,
    customer_id   int NOT NULL REFERENCES customers(id),
    plan          text NOT NULL,
    monthly_price numeric(10,2) NOT NULL,
    started_at    timestamptz NOT NULL,
    cancelled_at  timestamptz
);
COMMENT ON TABLE subscriptions IS 'Recurring subscriptions';

CREATE TABLE IF NOT EXISTS events (
    id           bigint PRIMARY KEY,
    customer_id  int REFERENCES customers(id),
    event_name   text NOT NULL,
    occurred_at  timestamptz NOT NULL
);
COMMENT ON TABLE events IS 'Product usage events';

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

INSERT INTO categories (id, name, slug) VALUES
    (1, 'Electronics', 'electronics'),
    (2, 'Home & Kitchen', 'home-kitchen'),
    (3, 'Apparel', 'apparel'),
    (4, 'Books', 'books'),
    (5, 'Sports', 'sports')
ON CONFLICT DO NOTHING;

INSERT INTO products (id, category_id, name, sku, unit_price, is_active, created_at)
SELECT
    g,
    (g % 5) + 1,
    'Product ' || g,
    'SKU-' || lpad(g::text, 5, '0'),
    round((((g * 37) % 900) + 100)::numeric, 2),
    (g % 17) <> 0,
    now() - ((g % 500) || ' days')::interval
FROM generate_series(1, 200) g
ON CONFLICT DO NOTHING;

INSERT INTO customers (id, email, full_name, phone, city, country, status, created_at)
SELECT
    g,
    'customer' || g || '@example.com',
    'Customer ' || g,
    '+91-98' || lpad(((g * 7919) % 100000000)::text, 8, '0'),
    (ARRAY['Hyderabad','Bengaluru','Mumbai','Delhi','Pune','Chennai','Kolkata'])[(g % 7) + 1],
    'India',
    CASE WHEN g % 11 = 0 THEN 'churned' WHEN g % 53 = 0 THEN 'suspended' ELSE 'active' END,
    now() - ((g % 730) || ' days')::interval
FROM generate_series(1, 2000) g
ON CONFLICT DO NOTHING;

-- Orders spread over the last ~13 months so month-over-month questions work.
INSERT INTO orders (id, customer_id, status, total_amount, created_at)
SELECT
    g,
    ((g * 13) % 2000) + 1,
    CASE
        WHEN g % 19 = 0 THEN 'cancelled'
        WHEN g % 23 = 0 THEN 'refunded'
        WHEN g % 7  = 0 THEN 'pending'
        ELSE 'completed'
    END,
    round((((g * 53) % 15000) + 500)::numeric, 2),
    now() - ((g % 400) || ' days')::interval
FROM generate_series(1, 18000) g
ON CONFLICT DO NOTHING;

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, line_total)
SELECT
    g,
    ((g - 1) / 2) + 1,
    ((g * 17) % 200) + 1,
    (g % 4) + 1,
    round((((g * 37) % 900) + 100)::numeric, 2),
    round(((((g * 37) % 900) + 100) * ((g % 4) + 1))::numeric, 2)
FROM generate_series(1, 36000) g
WHERE ((g - 1) / 2) + 1 <= 18000
ON CONFLICT DO NOTHING;

INSERT INTO payments (id, order_id, method, amount, status, paid_at)
SELECT
    o.id,
    o.id,
    (ARRAY['card','upi','netbanking','wallet','cod'])[(o.id % 5) + 1],
    o.total_amount,
    CASE WHEN o.status IN ('cancelled','refunded') THEN 'failed' ELSE 'captured' END,
    CASE WHEN o.status IN ('cancelled','refunded') THEN NULL ELSE o.created_at + interval '2 hours' END
FROM orders o
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (id, customer_id, plan, monthly_price, started_at, cancelled_at)
SELECT
    g,
    g,
    (ARRAY['free','starter','pro','enterprise'])[(g % 4) + 1],
    (ARRAY[0, 499, 1999, 9999])[(g % 4) + 1]::numeric,
    now() - ((g % 700) || ' days')::interval,
    CASE WHEN g % 9 = 0 THEN now() - ((g % 90) || ' days')::interval ELSE NULL END
FROM generate_series(1, 800) g
ON CONFLICT DO NOTHING;

INSERT INTO events (id, customer_id, event_name, occurred_at)
SELECT
    g,
    ((g * 31) % 2000) + 1,
    (ARRAY['login','view_product','add_to_cart','checkout','support_ticket'])[(g % 5) + 1],
    now() - ((g % 90) || ' days')::interval
FROM generate_series(1, 50000) g
ON CONFLICT DO NOTHING;

-- Indexes matching the access patterns the copilot generates, so EXPLAIN
-- reports realistic costs rather than seq scans everywhere.
CREATE INDEX IF NOT EXISTS ix_orders_created_at   ON orders (created_at);
CREATE INDEX IF NOT EXISTS ix_orders_customer     ON orders (customer_id);
CREATE INDEX IF NOT EXISTS ix_orders_status       ON orders (status);
CREATE INDEX IF NOT EXISTS ix_order_items_order   ON order_items (order_id);
CREATE INDEX IF NOT EXISTS ix_order_items_product ON order_items (product_id);
CREATE INDEX IF NOT EXISTS ix_customers_city      ON customers (city);
CREATE INDEX IF NOT EXISTS ix_customers_status    ON customers (status);
CREATE INDEX IF NOT EXISTS ix_events_customer     ON events (customer_id);
CREATE INDEX IF NOT EXISTS ix_events_occurred     ON events (occurred_at);

ANALYZE;

-- ---------------------------------------------------------------------------
-- Read-only role
-- ---------------------------------------------------------------------------
-- This is what a customer should create for the copilot. It is the layer that
-- holds even if application-level validation is bypassed entirely.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'copilot_readonly') THEN
        CREATE ROLE copilot_readonly LOGIN PASSWORD 'copilot_readonly_pw';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE demo_analytics TO copilot_readonly;
GRANT USAGE ON SCHEMA public TO copilot_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO copilot_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO copilot_readonly;
-- Explicitly ensure no write path exists.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM copilot_readonly;
REVOKE CREATE ON SCHEMA public FROM copilot_readonly;
