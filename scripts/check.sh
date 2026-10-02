#!/bin/sh
set -e
bun install --frozen-lockfile
bun run format:check
bun run lint
bunx turbo typecheck
bunx turbo test
bunx turbo build
