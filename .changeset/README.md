# Changesets

Versioning uses [Changesets](https://github.com/changesets/changesets).

~~~bash
bunx changeset
bun run version-packages
bun run release:dry
bunx changeset publish
~~~

Only packages explicitly configured for publication should be released. Review the generated release plan and packed artifacts before publishing.

Changesets describe release intent. They do not replace the repository verification gates.
