#!/bin/sh
set -e

DATA_DIR=/app/data

# Initialize local.db from seed data on first run (empty volume)
if [ ! -f "$DATA_DIR/local.db" ] || [ ! -s "$DATA_DIR/local.db" ]; then
  if [ -f /app/seed/local.db ]; then
    echo "[entrypoint] Initializing local.db from seed data..."
    cp /app/seed/local.db "$DATA_DIR/local.db"
  fi
fi

# Ensure correct ownership (needs root, container runs as root via entrypoint)
chown -R nextjs:nodejs "$DATA_DIR" 2>/dev/null || true

exec su-exec nextjs node server.js
