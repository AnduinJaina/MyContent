# Zero-Cost Home-Lab Deployment: MyContent+

## Infra Blueprint

```
Internet ──▶ Traefik (:80/:443, TLS via Let's Encrypt)
               ├─▶ frontend.mycontent.home   → frontend container (Next.js/PWA)
               ├─▶ api.mycontent.home        → backend container (Node.js)
               └─▶ minio.mycontent.home      → minio console/API
                        (internal, no route) → postgres, redis, worker, renderer
```

- Single Docker host (home lab box). All services on one `docker-compose.yml`.
- Traefik is the only exposed entrypoint; everything else on an internal network.
- No paid cloud services — Let's Encrypt for TLS, local disk volumes for persistence.

## Minimal Dockerfiles

**frontend/Dockerfile**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```

**backend/Dockerfile**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/main.js"]
```

**worker/Dockerfile** (BullMQ workers — same codebase as backend, different entrypoint)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
CMD ["node", "dist/workers/index.js"]
```

**renderer/Dockerfile** (Python/ffmpeg/moviepy)
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY render.py .
CMD ["python3", "render.py"]
```

## docker-compose.yml

```yaml
version: "3.9"

networks:
  public:
  internal:
    internal: true

volumes:
  postgres-data:
  redis-data:
  minio-data:
  traefik-certs:

services:
  traefik:
    image: traefik:v3.0
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.httpchallenge=true
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.le.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.le.acme.storage=/certs/acme.json
    ports: ["80:80", "443:443"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/certs
    networks: [public]
    restart: unless-stopped

  frontend:
    build: ./frontend
    env_file: .env
    networks: [public, internal]
    labels:
      - traefik.enable=true
      - traefik.http.routers.frontend.rule=Host(`${FRONTEND_HOST}`)
      - traefik.http.routers.frontend.entrypoints=websecure
      - traefik.http.routers.frontend.tls.certresolver=le
      - traefik.http.services.frontend.loadbalancer.server.port=3000
    restart: unless-stopped

  backend:
    build: ./backend
    env_file: .env
    networks: [public, internal]
    depends_on: [postgres, redis, minio]
    labels:
      - traefik.enable=true
      - traefik.http.routers.backend.rule=Host(`${API_HOST}`)
      - traefik.http.routers.backend.entrypoints=websecure
      - traefik.http.routers.backend.tls.certresolver=le
      - traefik.http.services.backend.loadbalancer.server.port=4000
    restart: unless-stopped

  worker:
    build: ./worker
    env_file: .env
    networks: [internal]
    depends_on: [postgres, redis, minio]
    restart: unless-stopped

  renderer:
    build: ./renderer
    env_file: .env
    networks: [internal]
    depends_on: [redis, minio]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    env_file: .env
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    networks: [internal]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes: ["redis-data:/data"]
    networks: [internal]
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    env_file: .env
    volumes: ["minio-data:/data"]
    networks: [public, internal]
    labels:
      - traefik.enable=true
      - traefik.http.routers.minio.rule=Host(`${MINIO_HOST}`)
      - traefik.http.routers.minio.entrypoints=websecure
      - traefik.http.routers.minio.tls.certresolver=le
      - traefik.http.services.minio.loadbalancer.server.port=9001
    restart: unless-stopped
```

## Environment Variables (`.env`)

```dotenv
# Domains
ACME_EMAIL=you@example.com
FRONTEND_HOST=app.mycontent.home
API_HOST=api.mycontent.home
MINIO_HOST=minio.mycontent.home

# Claude
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# Postgres
POSTGRES_USER=mycontent
POSTGRES_PASSWORD=changeme
POSTGRES_DB=mycontent
DATABASE_URL=postgresql://mycontent:changeme@postgres:5432/mycontent

# Redis
REDIS_URL=redis://redis:6379

# MinIO
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=changeme
MINIO_ENDPOINT=minio
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=changeme
```

## PWA (Next.js) — Mobile Install

- `public/manifest.json` with `name`, `short_name`, `icons`, `start_url`, `display: "standalone"`.
- Minimal service worker (`public/sw.js`) registered in `_app` for offline shell + installability.
- Served over HTTPS via Traefik (required for install prompt on Android/iOS).

## CI/CD: GitHub Actions → Build → Deploy via SSH

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build images
        run: |
          docker build -t mycontent/frontend:latest ./frontend
          docker build -t mycontent/backend:latest ./backend
          docker build -t mycontent/worker:latest ./worker
          docker build -t mycontent/renderer:latest ./renderer

      - name: Save images to tarball
        run: |
          docker save mycontent/frontend:latest mycontent/backend:latest \
            mycontent/worker:latest mycontent/renderer:latest -o images.tar

      - name: Copy images + compose to home lab
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.HOMELAB_HOST }}
          username: ${{ secrets.HOMELAB_USER }}
          key: ${{ secrets.HOMELAB_SSH_KEY }}
          source: "images.tar,docker-compose.yml"
          target: "/opt/mycontent/"

      - name: Load images and restart stack
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.HOMELAB_HOST }}
          username: ${{ secrets.HOMELAB_USER }}
          key: ${{ secrets.HOMELAB_SSH_KEY }}
          script: |
            cd /opt/mycontent
            docker load -i images.tar
            docker compose up -d --no-build
            docker image prune -f
```

- Secrets stored in GitHub repo settings: `HOMELAB_HOST`, `HOMELAB_USER`, `HOMELAB_SSH_KEY`.
- `.env` lives only on the home-lab host (never committed); `docker compose up -d` picks it up on restart.
- No registry needed — images are built in CI, tarred, `scp`'d, and loaded directly on the host (zero-cost, no Docker Hub/GHCR dependency).
