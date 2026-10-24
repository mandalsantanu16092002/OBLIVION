FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# workspace manifests first for better layer caching
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rules-engine/package.json packages/rules-engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/ai-service/package.json apps/ai-service/
RUN npm install --workspace=@onboardiq/api --include=dev --no-audit --no-fund

COPY packages/ packages/
COPY apps/api/ apps/api/
COPY data/ data/

RUN mkdir -p storage/documents output && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
WORKDIR /app/apps/api
CMD ["npx", "tsx", "src/index.ts"]
