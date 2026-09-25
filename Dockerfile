FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4187 \
    TRIP_HOST=0.0.0.0 \
    TRIP_DATABASE_PATH=/app/data/trips.sqlite \
    TRIP_COOKIE_SECURE=1

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json route-api.mjs server.mjs ./
COPY --chown=node:node src/dto/trip-workspace.dto.ts ./src/dto/trip-workspace.dto.ts
COPY --chown=node:node src/services/date.service.ts ./src/services/date.service.ts
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4187
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4187/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
