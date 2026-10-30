# HeroScape Draft: one container serving the site, the API and photos.
# Data (SQLite database + photos) lives in /data; mount a persistent volume there.

# --- Build the site --------------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# --- Runtime: Node only, no npm packages needed ----------------------------------------------
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8000 \
    DATA_DIR=/data \
    SITE_DIR=/app/dist

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/lib/draft.ts /app/src/lib/types.ts ./src/lib/
COPY --from=build /app/src/data ./src/data
RUN rm -f server/*.test.ts \
 && mkdir -p /data && chown node:node /data

USER node
EXPOSE 8000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.ts"]
