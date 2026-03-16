FROM node:20-bookworm-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .

# Build the web app
WORKDIR /app/apps/web
RUN npm run build

# Make entrypoint executable
WORKDIR /app
RUN chmod +x /app/docker/entrypoint.sh

EXPOSE 3000
CMD ["/app/docker/entrypoint.sh"]
