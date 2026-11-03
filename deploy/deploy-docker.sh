#!/usr/bin/env bash
# Build and (re)start WhoHasAccess as a hardened Docker container. Run from the repo root.
# The container serves plain HTTP on :8080; put your own TLS reverse proxy in front
# (Caddy, nginx, Traefik, a Cloudflare Tunnel ...) and add its https:// origin to your
# OAuth client's Authorized JavaScript origins.
#
#   VITE_GOOGLE_CLIENT_ID=<your client id> ./deploy/deploy-docker.sh
#
# Optional: NAME (container name, default whohasaccess), PORT (host port, default 8080,
# bound to 127.0.0.1 only), NETWORK (join an existing Docker network instead of publishing a port).
set -euo pipefail

NAME=${NAME:-whohasaccess}
PORT=${PORT:-8080}
VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}   # empty = visitors paste their own in the app

docker build --pull -t "$NAME:latest" --build-arg VITE_GOOGLE_CLIENT_ID="$VITE_GOOGLE_CLIENT_ID" .

if [ -n "${NETWORK:-}" ]; then NET_ARGS=(--network "$NETWORK"); else NET_ARGS=(-p "127.0.0.1:$PORT:8080"); fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart=unless-stopped "${NET_ARGS[@]}" \
  --read-only \
  --tmpfs /tmp --tmpfs /data:uid=1000,gid=1000 --tmpfs /config:uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m \
  "$NAME:latest"

docker image prune -f >/dev/null
echo "Running: $NAME (health check: /healthz)"
