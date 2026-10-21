FROM node:24-bookworm-slim AS build
ENV CI=true
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
RUN pnpm mcp:build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ARG VCS_REF=unreleased
LABEL org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.local/build ./.local/build
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
CMD ["node", ".local/build/mcp-server.mjs"]
