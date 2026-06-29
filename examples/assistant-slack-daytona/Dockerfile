# The webhook SERVER image. This long-running Flue server receives Slack events
# and dispatches to agents — it does NOT run the model's shell/file work itself
# (that happens in each thread's remote Daytona sandbox). So, unlike the k8s
# example, it does NOT bake AGENTS.md / .agents: those are discovered from the
# sandbox filesystem and are baked into the Daytona snapshot instead (see
# Dockerfile.sandbox).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx flue build --target node

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Flue's node server binds PORT (default 3000); we expose 8080.
ENV PORT=8080

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

# Run as non-root.
USER node

EXPOSE 8080
CMD ["node", "dist/server.mjs"]
