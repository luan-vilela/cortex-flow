#!/bin/bash
set -e

echo "� Parando containers..."
docker compose down

echo "🗑️  Deletando dist..."
rm -rf dist

echo "📦 Construindo projeto NestJS..."
docker compose up --build api -d

echo "📜 Acompanhando logs do NestJS..."
docker compose logs -f api
