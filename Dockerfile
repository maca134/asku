FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373
WORKDIR /app
COPY --from=build /app/api api
COPY --from=build /app/dist dist
RUN mkdir /data && chown bun:bun /data
USER bun
ENV ASKU_DB=/data/asku.db
EXPOSE 8080
CMD ["bun", "api/relay.ts"]
