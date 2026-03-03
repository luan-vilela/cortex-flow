#!/bin/bash
set -e

echo " logs do NestJS e Node-RED..."
docker compose -f ~/Level67/crm/cortex-flow/docker-compose.yml logs -f api node-red