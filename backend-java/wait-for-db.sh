#!/bin/bash
host=$1
port=$2
shift 2
cmd="$@"

echo "Waiting for $host:$port..."
until nc -z "$host" "$port"; do
  echo "Waiting for database to be ready..."
  sleep 2
done
echo "Database is ready! Running command..."
exec $cmd
