# Multi-stage build: compile the Flue node target, ship only the runtime.
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

# Built server + the workspace files discovered at runtime (AGENTS.md, skills).
COPY --from=build /app/dist ./dist
COPY AGENTS.md ./AGENTS.md
COPY .agents ./.agents

# Run as non-root.
USER node

EXPOSE 8080
CMD ["node", "dist/server.mjs"]
