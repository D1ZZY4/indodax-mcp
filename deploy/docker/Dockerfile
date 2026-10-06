FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY packages ./packages
COPY apps ./apps
# indodax_docs serves the per-area agent guides by walking up from the module
# to docs/tools or docs-tools. Without this copy the tool reported "guide pages
# unavailable at runtime" in the image even though the pages exist in the repo.
COPY docs ./docs
RUN bun install --frozen-lockfile
EXPOSE 8000
CMD ["bun", "apps/mcp-http/src/main.ts"]
