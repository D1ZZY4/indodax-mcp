# Changesets

Versioning uses [Changesets](https://github.com/changesets/changesets).

```bash
bunx changeset          # record a change (patch, minor, major)
bun run version-packages # apply versions plus changelogs (dry review first)
bunx changeset publish   # publish to npm (maintainer only, never automatic)
```

Only `indodax-mcp` and `@indodax-mcp/cli` are publishable. Everything
else stays `private: true` and is ignored by the release plan.
