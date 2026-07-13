# Clone Tournament Database

`scripts/clone_tournament_db.sh` replaces a target MariaDB database with a complete clone of a source database. It is intended for refreshing an isolated test database from a controlled source.

## Safety Requirements

- Stop every backend instance that can write to either database.
- Verify the source and target names before confirming the operation.
- Never use the production database as the target.
- Run with a MariaDB account allowed to dump the source and drop, create, and restore the target.
- Keep generated dumps in `/tmp` only as long as needed; they contain database data and must not be committed.

## Usage

```bash
./scripts/clone_tournament_db.sh [source_db] [target_db] [mysql_user] [mysql_host] [--skip-ssl]
```

Defaults are `tournament`, `tournament-test`, `root`, and `localhost`. The script prompts for the database password without echoing it and stores it only in a temporary `0600` client file that is removed on exit.

The script verifies connectivity and both database names, requires an explicit `yes`, backs up the previous target under `/tmp`, dumps the source transactionally, recreates the target, restores the dump, and compares table counts.

## Recovery

The completion summary prints the source dump and target backup paths. If validation after the clone fails, keep services stopped and restore the target backup with the normal MariaDB client before restarting the application.
