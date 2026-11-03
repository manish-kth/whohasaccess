# Build the static site, then serve it with a small Caddy (a reverse proxy in front handles TLS).
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional: bake a Google OAuth Client ID into the build (it's public, not a secret).
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# Drop the binary's file capability (cap_net_bind_service): the container runs with
# --cap-drop ALL + no-new-privileges, under which exec of a file-capable binary fails. :8080 doesn't need it.
RUN setcap -r /usr/bin/caddy
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
