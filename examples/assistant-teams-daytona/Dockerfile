# Webhook server image. Receives Teams Bot Connector activities and dispatches to
# agents. Does NOT run the model's shell/file work — that happens in each
# conversation's remote Daytona sandbox. AGENTS.md/.agents/ are baked into the
# sandbox snapshot (Dockerfile.sandbox), not here.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx flue build --target node

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.mjs"]
