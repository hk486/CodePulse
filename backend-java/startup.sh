#!/bin/bash

# CodePulse Microservices Startup Script

echo "============================================"
echo "CodePulse Backend - Microservices Startup"
echo "============================================"
echo ""

# Check if Docker is running
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "📦 Starting Docker services..."
docker-compose up -d

echo "⏳ Waiting for databases to be ready..."
sleep 10

echo ""
echo "🏗️  Building microservices..."
mvn clean install -DskipTests

echo ""
echo "🚀 Starting microservices..."
echo ""

# Function to start a service
start_service() {
    local service=$1
    local port=$2
    echo "Starting $service on port $port..."
    cd $service
    mvn spring-boot:run &
    cd ..
    sleep 3
}

# Start all services
start_service "auth-service" 8001
start_service "project-service" 8002
start_service "analysis-service" 8003
start_service "notification-service" 8004
start_service "api-gateway" 8000

echo ""
echo "============================================"
echo "✅ CodePulse Backend Started Successfully!"
echo "============================================"
echo ""
echo "Services:"
echo "  🔐 Auth Service:         http://localhost:8001"
echo "  📁 Project Service:      http://localhost:8002"
echo "  🔍 Analysis Service:     http://localhost:8003"
echo "  📧 Notification Service: http://localhost:8004"
echo "  🚪 API Gateway:          http://localhost:8000"
echo ""
echo "Databases:"
echo "  🗄️  Auth DB:       jdbc:mysql://localhost:3306/codepulse_auth"
echo "  🗄️  Project DB:    jdbc:mysql://localhost:3307/codepulse_project"
echo "  🗄️  Analysis DB:   jdbc:mysql://localhost:3308/codepulse_analysis"
echo "  🗄️  Notification DB: jdbc:mysql://localhost:3309/codepulse_notification"
echo ""
echo "💡 To stop all services: docker-compose down"
echo "============================================"
