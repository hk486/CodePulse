#!/bin/bash

# Start backend in background
cd backend
echo "Starting backend server..."
node src/index.js &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start frontend in background
cd ../frontend
echo "Starting frontend dev server..."
npm run dev &
FRONTEND_PID=$!

# Wait for frontend to start
sleep 3

echo ""
echo "✓ CodePulse is running!"
echo "  Backend: http://localhost:5000/api"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop"

# Wait for either process to exit
wait
