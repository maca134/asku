FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-alpine
WORKDIR /app
COPY --from=build /app/src/relay.ts src/relay.ts
COPY --from=build /app/dist dist
RUN mkdir /data && chown bun:bun /data
USER bun
ENV ASKU_DB=/data/asku.db
EXPOSE 8080
CMD ["bun", "src/relay.ts"]
