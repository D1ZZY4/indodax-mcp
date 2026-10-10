# @indodax-mcp/db

## 2.1.0

### Patch Changes

- Run the database suite in a disposable database.
  
  The suite treated an ambient `DATABASE_URL` as a throwaway database. It
  applied every migration with `client.unsafe(sql)` and inserted a tenant row,
  with no isolation and no cleanup, so it both failed on every run after the
  first and wrote test tables into the database the application actually uses.
  
  The migrations are plain `CREATE TABLE` scripts with no `IF NOT EXISTS` guard
  and no drop step, because the real migrator tracks applied files in its own
  journal. Replaying them against a schema that already exists fails on the
  first `CREATE`. That is invisible on a fresh CI service container and fatal
  everywhere else, because a developer's `DATABASE_URL` is populated.
  
  Each run now creates its own database, applies the migrations there, and
  drops it afterwards. A user whose role lacks `CREATEDB` gets an explicit
  error naming the requirement instead of an opaque failure.
  
  Test-only change. No published behaviour differs.

## 2.0.0

No changes in this release.
