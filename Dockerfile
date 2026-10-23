FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f
WORKDIR /app
COPY --from=build /app/src/relay.ts src/relay.ts
COPY --from=build /app/dist dist
RUN mkdir /data && chown bun:bun /data
USER bun
ENV ASKU_DB=/data/asku.db
EXPOSE 8080
CMD ["bun", "src/relay.ts"]
