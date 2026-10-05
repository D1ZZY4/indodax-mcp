<h1 align="center">Dependency compatibility</h1>

Verified snapshot: 2026-10-05, Bun 1.4.2, TypeScript 7.0.2.

This document records the dependency versions and compatibility decisions used by the current repository. It is a snapshot, not a promise that these versions remain latest forever.

## MCP SDK

- @modelcontextprotocol/server 2.3.0
- @modelcontextprotocol/core 2.3.0
- @modelcontextprotocol/client 2.3.0
- @modelcontextprotocol/hono 2.0.2

The repository uses MCP SDK v2 APIs and negotiates protocol 2025-11-25 in the current SDK environment.

## Web and database

- hono 4.13.13
- @hono/standard-validator 0.4.0
- postgres 3.4.9
- drizzle-orm 0.45.3
- drizzle-kit 0.31.11

## Language and tooling

- TypeScript 7.0 line
- Biome 2.5.15
- Turborepo 2.11.7
- Vitest 5.0.3
- fast-check 4.10.2
- msw 3.0.0
- Playwright 1.63.0

## Application libraries

- citty 0.2.2
- @clack/prompts 0.11.x
- pino 10.4.0
- decimal.js 10.6.0
- @t3-oss/env-core 0.13.11
- React 19.3.0
- Vite 8.3.2
- Tailwind CSS 4.x
- TanStack Query 5.x

Exact lockfile resolution remains **authoritative** for installed transitive versions.

## Conditional dependencies

The repository currently avoids adding these without a demonstrated requirement:

- jose
- @hono/zod-openapi
- @scalar/hono-api-reference
- BullMQ
- ioredis
- OpenTelemetry exporters or SDK additions

## Environment deviations

Development and tests can use embedded PostgreSQL binaries when a system PostgreSQL service is unavailable. Production is expected to use external PostgreSQL via DATABASE_URL.

The main application composition does not currently depend on the database package at runtime.

## Maintenance rule

Recheck dependency exports, peer requirements, and runtime behavior after upgrades. Update this snapshot when a compatibility decision changes.
