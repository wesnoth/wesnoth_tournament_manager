#!/bin/bash
#
# Script to clone tournament database to tournament-test
# IMPORTANT: Backend services MUST be stopped before running this script.
#
# Usage: ./clone_tournament_db.sh [source_db] [target_db] [mysql_user] [mysql_host] [--skip-ssl]
# Example: ./clone_tournament_db.sh tournament tournament-test root localhost
# Example with --skip-ssl: ./clone_tournament_db.sh tournament tournament-test root localhost --skip-ssl
#

set -euo pipefail

# Default values
SOURCE_DB="${1:-tournament}"
TARGET_DB="${2:-tournament-test}"
MYSQL_USER="${3:-root}"
MYSQL_HOST="${4:-localhost}"
MYSQL_PASSWORD=""
SKIP_SSL=""

if [[ ! "$SOURCE_DB" =~ ^[A-Za-z0-9_-]+$ || ! "$TARGET_DB" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: Database names may only contain letters, numbers, underscores, and hyphens."
    exit 1
fi

if [ "$SOURCE_DB" = "$TARGET_DB" ]; then
    echo "ERROR: Source and target databases must be different."
    exit 1
fi

# Check for --skip-ssl flag
if [ "${5:-}" = "--skip-ssl" ]; then
    SKIP_SSL="--skip-ssl"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}================================================${NC}"
echo -e "${YELLOW}Database Clone Script: $SOURCE_DB → $TARGET_DB${NC}"
echo -e "${YELLOW}================================================${NC}"
echo ""

# Step 1: Verify backend is stopped
echo -e "${YELLOW}[Step 1]${NC} Verifying backend services are stopped..."
if pgrep -f "dist/server.js|tsx watch src/server.ts" > /dev/null; then
    echo -e "${RED}ERROR: Backend services are still running!${NC}"
    echo "Please stop the backend services before running this script."
    echo ""
    echo "Stop the backend process or service and run this command again."
    exit 1
fi
echo -e "${GREEN}✓ Backend services are stopped${NC}"
echo ""

# Step 2: Prompt for MySQL password
echo -e "${YELLOW}[Step 2]${NC} MySQL Authentication..."
echo -n "Enter MySQL password for user '$MYSQL_USER' (or press Enter for no password): "
read -s MYSQL_PASSWORD
echo ""
echo ""

# Keep the password out of command arguments and remove the temporary file on every exit path.
AUTH_FILE=$(mktemp /tmp/tournament-db-clone-auth.XXXXXX)
chmod 600 "$AUTH_FILE"
trap 'rm -f "$AUTH_FILE"' EXIT
printf '[client]\nhost=%s\nuser=%s\npassword=%s\n' \
    "$MYSQL_HOST" "$MYSQL_USER" "$MYSQL_PASSWORD" > "$AUTH_FILE"
unset MYSQL_PASSWORD

MYSQL_CMD=(mysql "--defaults-extra-file=$AUTH_FILE")
MYSQLDUMP_CMD=(mysqldump "--defaults-extra-file=$AUTH_FILE")
if [ -n "$SKIP_SSL" ]; then
    MYSQL_CMD+=("$SKIP_SSL")
    MYSQLDUMP_CMD+=("$SKIP_SSL")
fi

# Step 3: Verify connectivity
echo -e "${YELLOW}[Step 3]${NC} Verifying database connectivity..."
if ! "${MYSQL_CMD[@]}" -e "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Cannot connect to MySQL!${NC}"
    echo "Check your credentials and host."
    exit 1
fi
echo -e "${GREEN}✓ Connected to MySQL${NC}"
echo ""

# Step 4: Verify source database exists
echo -e "${YELLOW}[Step 4]${NC} Verifying source database '$SOURCE_DB' exists..."
if ! "${MYSQL_CMD[@]}" -e "USE \`$SOURCE_DB\`;" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Source database '$SOURCE_DB' does not exist!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Source database exists${NC}"
echo ""

# Step 5: Verify target database exists (should be empty)
echo -e "${YELLOW}[Step 5]${NC} Verifying target database '$TARGET_DB' exists..."
if ! "${MYSQL_CMD[@]}" -e "USE \`$TARGET_DB\`;" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Target database '$TARGET_DB' does not exist!${NC}"
    echo "Create it with: mysql -u root -p -e 'CREATE DATABASE $TARGET_DB;'"
    exit 1
fi
echo -e "${GREEN}✓ Target database exists${NC}"
echo ""

# Step 6: Warning before truncating
echo -e "${RED}⚠️  WARNING${NC}"
echo "This will DELETE ALL DATA in database '$TARGET_DB' and replace it with data from '$SOURCE_DB'."
echo ""
read -p "Are you sure? Type 'yes' to confirm: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi
echo ""

# Step 7: Backup target database (just in case)
echo -e "${YELLOW}[Step 6]${NC} Creating backup of target database..."
BACKUP_FILE="/tmp/${TARGET_DB}_backup_$(date +%Y%m%d_%H%M%S).sql"
if "${MYSQLDUMP_CMD[@]}" "$TARGET_DB" > "$BACKUP_FILE" 2>/dev/null; then
    echo -e "${GREEN}✓ Backup created: $BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}⚠ Backup skipped (database may be empty)${NC}"
fi
echo ""

# Step 7: Dump source database
echo -e "${YELLOW}[Step 7]${NC} Dumping source database '$SOURCE_DB'..."
DUMP_FILE="/tmp/${SOURCE_DB}_dump_$(date +%Y%m%d_%H%M%S).sql"
"${MYSQLDUMP_CMD[@]}" --single-transaction --quick --lock-tables=false "$SOURCE_DB" > "$DUMP_FILE"
echo -e "${GREEN}✓ Dump created: $DUMP_FILE${NC}"
echo ""

# Step 8: Clear target database
echo -e "${YELLOW}[Step 8]${NC} Clearing target database '$TARGET_DB'..."
"${MYSQL_CMD[@]}" -e "DROP DATABASE \`$TARGET_DB\`; CREATE DATABASE \`$TARGET_DB\`;"
echo -e "${GREEN}✓ Target database cleared and recreated${NC}"
echo ""

# Step 9: Restore dump to target
echo -e "${YELLOW}[Step 9]${NC} Restoring dump to target database '$TARGET_DB'..."
"${MYSQL_CMD[@]}" "$TARGET_DB" < "$DUMP_FILE"
echo -e "${GREEN}✓ Data restored${NC}"
echo ""

# Step 10: Verify clone
echo -e "${YELLOW}[Step 10]${NC} Verifying clone integrity..."
SOURCE_COUNT=$("${MYSQL_CMD[@]}" -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$SOURCE_DB';")
TARGET_COUNT=$("${MYSQL_CMD[@]}" -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TARGET_DB';")

if [ "$SOURCE_COUNT" -eq "$TARGET_COUNT" ]; then
    echo -e "${GREEN}✓ Clone successful!${NC}"
    echo "  Source tables: $SOURCE_COUNT"
    echo "  Target tables: $TARGET_COUNT"
else
    echo -e "${RED}ERROR: Table count mismatch!${NC}"
    echo "  Source tables: $SOURCE_COUNT"
    echo "  Target tables: $TARGET_COUNT"
    exit 1
fi
echo ""

# Step 11: Summary
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✓ Database clone completed successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Summary:"
echo "  Source:   $SOURCE_DB"
echo "  Target:   $TARGET_DB"
echo "  Dump:     $DUMP_FILE"
echo "  Backup:   $BACKUP_FILE"
echo ""
echo "Next steps:"
echo "  1. Verify data in '$TARGET_DB' using your normal MariaDB client configuration"
echo "  2. Restart backend services"
echo ""
