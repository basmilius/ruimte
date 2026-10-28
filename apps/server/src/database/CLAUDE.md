# Databases

`apps/server/README.md` ("Databases") has the files, the helper and the passwords. The verb: `apps/server/src/canvas/database-verb.ts`.

- The daemon runs the `@adecore/database` host behind `database.request`, with Ruimte's checks on connections and files; the compiled daemon carries the helper in `native/`. A project's connections live in `.ruimte/databases.json` and its private twin, never with a password.
- The SQL server and SQL in PHP strings read the daemon's schema snapshots (`schema-snapshots.ts`). Which connection a file reads is one person's choice in the private project file (`sql-analysis.ts`).

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Agents read a project's databases through `ruimte-context database`, read-only by default: one SELECT or WITH statement through `page` on a read-only session, and a SQLite file only inside the project folder.
- Writing (`execute`) works only on a connection a person on this machine set to write, kept under `$RUIMTE_HOME/database-access`, never in the project (`agent-access.ts`), and never from `supervised`.
- The daemon holds a password only in memory, handed over by a project client and bound to where the connection pointed then. It drops it when the last client lets the project go (`agent-passwords.ts`).
