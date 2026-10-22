# SQL injection review and installation schema

## Findings

The reviewed runtime repository uses mysql2 `execute(sql, values)` placeholders
for request-controlled values (usernames, IDs, passwords/hashes, session tokens,
content, media metadata, and settings). Quote characters or SQL-like text in
those values are data, not executable SQL.

Setup validates database identifiers against a strict 1–64 character allowlist.
Restore inserts use fixed application-defined table/column names and bound
values; the uploaded restore JSON does not supply SQL statements or table names.
Migration SQL is application-controlled, not accepted from HTTP requests.

No exploitable SQL injection was identified in these reviewed paths. This is
not a guarantee against every vulnerability or a substitute for an independent
security review. A schema alone cannot make string-concatenated queries safe.

## Defense in depth added

- MySQL pool and installer/restore connection options explicitly set
  `multipleStatements: false`, overriding accidental pool configuration changes.
- A shared strict database-identifier helper protects CREATE DATABASE in the
  installer, importer and CLI (including environment-derived CLI names).
- Auth history LIMIT is a bounded finite integer supplied as a query parameter,
  not SQL interpolation; fractions and SQL-shaped input cannot change the query.
- Regression tests exercise SQL-shaped input against repository query capture,
  setup validation, identifier validation and connection configuration.

Static SQL still includes trusted numeric constants, fixed schema/migration
statements and restore identifiers selected from application code. These are
not request-controlled SQL. Do not replace placeholders with string templates
for future feature work.

## First-install schema and upgrades

The existing browser installer calls `applySchema`, which creates the frozen
version-1 tables and applies every versioned migration through the latest
version. Existing installations apply pending migrations at startup as well.
No SQL import is required, and no unnecessary schema migration was introduced
for connection/query-level hardening. Shipped migrations and BASE_STATEMENTS
remain unchanged.

Create an empty database and a dedicated user in cPanel first, grant access
only to that application's database, then complete setup. A user needs the DDL
permissions required by migrations (CREATE/ALTER/INDEX etc.) on that database;
never grant global privileges, FILE, SUPER, or GRANT OPTION. Do not use MySQL
root as the app account. If using separate migration/runtime users, provision
migrations yourself before restricting the runtime user's DDL rights; the
built-in installer expects its configured user to be able to migrate.

## Operational requirements

Use HTTPS; keep database credentials and data/install.json private; never expose
the application directory as a file listing. Complete setup immediately before
sharing the domain. Update dependencies and retain the API's authentication,
role checks and disabled-account handling. Backups contain credential hashes
and must remain private. Do not accept untrusted backups merely because values
are SQL-bound: restoring is a privileged, destructive operation.

## Verification limits

Tests use a MySQL driver stub to verify placeholder separation plus the existing
setup/restore test suite. No live MySQL server or penetration-testing environment
was available here. The disposable Docker/MariaDB pipeline provides live startup
and schema checks but does not yet run a comprehensive SQL-injection attack suite.
