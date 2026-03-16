#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node /app/db/migrate.js

echo "[entrypoint] Starting web server..."
exec node /app/apps/web/.next/standalone/server.js
