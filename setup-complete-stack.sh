#!/bin/bash

echo "=================================================="
echo "CodePulse - Complete Stack Startup"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! command -v mvn &> /dev/null; then
    echo -e "${YELLOW}⚠️  Maven is not installed${NC}"
    echo "Install from: https://maven.apache.org/download.cgi"
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Start infrastructure
echo "🐳 Starting Docker containers..."
cd backend-java
docker-compose up -d

echo "⏳ Waiting 10 seconds for databases to initialize..."
sleep 10

# Build backend
echo "🔨 Building Spring Boot services..."
mvn clean install -DskipTests -q

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend built successfully${NC}"
else
    echo -e "${RED}❌ Backend build failed${NC}"
    exit 1
fi

cd ..

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install -q

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
else
    echo -e "${RED}❌ Frontend installation failed${NC}"
    exit 1
fi

cd ..

echo ""
echo "=================================================="
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "=================================================="
echo ""
echo "📝 Next Steps:"
echo ""
echo "1️⃣  In one terminal - Start Spring Boot services:"
echo "   cd backend-java"
echo "   mvn -pl api-gateway spring-boot:run &"
echo "   mvn -pl auth-service spring-boot:run &"
echo "   mvn -pl project-service spring-boot:run &"
echo "   mvn -pl analysis-service spring-boot:run &"
echo "   mvn -pl notification-service spring-boot:run"
echo ""
echo "2️⃣  In another terminal - Start Express backend:"
echo "   cd backend"
echo "   npm start"
echo ""
echo "3️⃣  In another terminal - Start React frontend:"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "4️⃣  Open browser and go to: http://localhost:3000"
echo ""
echo "📊 Service URLs:"
echo "   • Frontend:        http://localhost:3000"
echo "   • API Gateway:     http://localhost:8000"
echo "   • Auth Service:    http://localhost:8001"
echo "   • Project Service: http://localhost:8002"
echo "   • Analysis Service: http://localhost:8003"
echo "   • Notification:    http://localhost:8004"
echo "   • Express Backend: http://localhost:5000"
echo ""
echo "🗄️  Database:"
echo "   • MySQL Root:      localhost:3306 (pass: root)"
echo "   • Eureka:          http://localhost:8761"
echo ""
echo "💾 Stop everything:"
echo "   docker-compose down"
echo ""
echo "=================================================="
