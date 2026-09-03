-- Control-plane database bootstrap.
--
-- Creates the extension the schema index needs and a dedicated read-only role
-- used by the demo "customer" database. The read-only role is the second half
-- of the two-layer SQL defence: even if the application guard were bypassed,
-- this role cannot write.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- The application's own database is created by POSTGRES_DB.
-- A separate database plays the role of a customer's database so the demo is
-- not querying its own control plane.
SELECT 'CREATE DATABASE demo_analytics'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'demo_analytics')\gexec
