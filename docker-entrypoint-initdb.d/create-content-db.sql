-- Create the content_service database used by the content-service container.
-- This script runs automatically on first PostgreSQL initialisation.
SELECT 'CREATE DATABASE content_service'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'content_service')\gexec
