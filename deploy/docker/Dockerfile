FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --frozen-lockfile
EXPOSE 8000
CMD ["bun", "apps/mcp-http/src/main.ts"]
