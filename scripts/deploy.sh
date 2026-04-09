#!/usr/bin/env bash
# Helper: build the OctoMate image, push to Docker Hub, and print the Nosana
# deploy command. Replace DOCKER_USER with your Docker Hub username.
#
# Usage:  DOCKER_USER=myname ./scripts/deploy.sh [tag]

set -euo pipefail

DOCKER_USER="${DOCKER_USER:-}"
TAG="${1:-latest}"

if [[ -z "$DOCKER_USER" ]]; then
  echo "error: set DOCKER_USER=<your-dockerhub-username>"
  exit 1
fi

IMAGE="docker.io/${DOCKER_USER}/octomate:${TAG}"

echo "[deploy] building ${IMAGE}"
docker build -t "${IMAGE}" .

echo "[deploy] pushing ${IMAGE}"
docker push "${IMAGE}"

echo "[deploy] patching nos_job_def.json"
sed -i.bak "s|docker.io/REPLACE_ME/octomate:latest|${IMAGE}|" nos_job_def.json

echo ""
echo "Image pushed: ${IMAGE}"
echo "nos_job_def.json updated."
echo ""
echo "Next steps:"
echo "  1. Open https://deploy.nosana.com"
echo "  2. Connect your wallet"
echo "  3. Create a new deployment using nos_job_def.json"
echo "  4. Set env vars NOSANA_QWEN_ENDPOINT and NOSANA_QWEN_KEY"
echo "  5. Deploy and copy the public URL"
