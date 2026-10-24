FROM node:22-alpine AS build
WORKDIR /app
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/ai-service/package.json apps/ai-service/
COPY packages/rules-engine/package.json packages/rules-engine/
RUN npm install --workspace=@onboardiq/web --include=dev --no-audit --no-fund
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN npm run build --workspace=@onboardiq/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
