#!/bin/sh
set -e


echo "Starting server..."
exec node node_modules/.bin/fastify start -l info -a 0.0.0.0 dist/app.js
