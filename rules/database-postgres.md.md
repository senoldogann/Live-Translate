# DATABASE & SQL STANDARDS

## Core Philosophy
- **Integrity:** Database is the source of truth. Use Foreign Keys, NOT software-level checks.
- **Performance:** Index early.

## Coding Rules
1.  **Naming:** `snake_case` for all tables/columns.
2.  **Keys:** Use UUIDv7 (time-ordered) or BigInt. Avoid random UUIDv4 for clustered keys (fragmentation).
3.  **Queries:** No `SELECT *`. Explicitly select columns.
4.  **Migrations:** Down migrations must perfectly reverse Up migrations.
5.  **Connections:** Use a connection pool (pgxpool for Go).