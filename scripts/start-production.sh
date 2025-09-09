#!/bin/bash

# Legal Bot Production Startup Script
echo "🚀 Starting Legal Bot Production Environment..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Copy production environment if .env doesn't exist
if [ ! -f .env ]; then
    echo "📋 Copying production environment configuration..."
    cp .env.production .env
fi

# Build and start the services
echo "🔨 Building and starting services..."
docker compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check service health
echo "🔍 Checking service health..."

# Check legal-bot health
if curl -f http://localhost:3001/api/monitoring/health >/dev/null 2>&1; then
    echo "✅ Legal Bot: Running"
else
    echo "❌ Legal Bot: Not responding"
fi

# Check NGINX
if curl -f http://localhost:80/health >/dev/null 2>&1; then
    echo "✅ NGINX Proxy: Running"
else
    echo "❌ NGINX Proxy: Not responding"
fi

# Check Grafana
if curl -f http://localhost:3000 >/dev/null 2>&1; then
    echo "✅ Grafana Dashboard: Running"
else
    echo "❌ Grafana Dashboard: Not responding"
fi

# Check Prometheus
if curl -f http://localhost:9090 >/dev/null 2>&1; then
    echo "✅ Prometheus Metrics: Running"
else
    echo "❌ Prometheus Metrics: Not responding"
fi

echo ""
echo "🎉 Production environment status:"
echo "   Application:     http://localhost:3001"
echo "   NGINX Proxy:     http://localhost:80"
echo "   Grafana:         http://localhost:3000 (admin/admin)"
echo "   Prometheus:      http://localhost:9090"
echo "   Health Check:    http://localhost:3001/api/monitoring/health"
echo "   Metrics:         http://localhost:3001/api/monitoring/metrics"
echo ""
echo "📊 To view logs: docker compose logs -f [service_name]"
echo "🛑 To stop: docker compose down"
echo "🔄 To restart: docker compose restart"
