FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY workers/llm/package.json ./workers/llm/package.json

WORKDIR /app/workers/llm
RUN npm install

WORKDIR /app
COPY workers/llm/worker.js ./workers/llm/worker.js

WORKDIR /app/workers/llm
CMD ["node", "worker.js"]
