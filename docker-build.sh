#!/usr/bin/env bash
# Build and push single Docker image for equity.ark
# Usage: ./docker-build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
IMAGE="derycklong/equity-ark"
TAG="2026.6.14"

echo ">>> Building image..."
docker build -t "$IMAGE:$TAG" -t "$IMAGE:latest" "$ROOT"

echo ">>> Pushing to Docker Hub..."
docker push "$IMAGE:$TAG"
docker push "$IMAGE:latest"

echo ">>> Done. Images pushed:"
echo "    $IMAGE:$TAG"
echo "    $IMAGE:latest"
