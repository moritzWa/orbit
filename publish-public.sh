#!/bin/bash
set -euo pipefail

PRIVATE_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$PRIVATE_DIR/../personal-crm-public"

# === PRIVATE FILES THAT MUST NEVER BE PUBLISHED ===
BLOCKED_FILES=(
  "crm.db"
  "crm.db-wal"
  "crm.db-shm"
  ".sheets-token.json"
  "server/.env"
)
BLOCKED_DIRS=(
  "exports/"
  ".claude/"
)

echo "=== Syncing to public repo ==="

# Step 1: rsync code, excluding private data
rsync -av --delete \
  --exclude='.git/' \
  --exclude='crm.db' \
  --exclude='crm.db-wal' \
  --exclude='crm.db-shm' \
  --exclude='.sheets-token.json' \
  --exclude='server/.env' \
  --exclude='exports/' \
  --exclude='.claude/' \
  --exclude='node_modules/' \
  --exclude='client/node_modules/' \
  "$PRIVATE_DIR/" "$PUBLIC_DIR/"

# Step 2: Safety check - verify no private files leaked
echo ""
echo "=== Safety check ==="
LEAKED=0
for f in "${BLOCKED_FILES[@]}"; do
  if [ -f "$PUBLIC_DIR/$f" ]; then
    echo "DANGER: Private file found in public repo: $f"
    LEAKED=1
  fi
done
for d in "${BLOCKED_DIRS[@]}"; do
  if [ -d "$PUBLIC_DIR/$d" ]; then
    echo "DANGER: Private directory found in public repo: $d"
    LEAKED=1
  fi
done

# Check for any .db files
if find "$PUBLIC_DIR" -name "*.db" -o -name "*.mbox" -o -name "*.storedata" 2>/dev/null | grep -q .; then
  echo "DANGER: Database/mbox files found in public repo!"
  find "$PUBLIC_DIR" -name "*.db" -o -name "*.mbox" -o -name "*.storedata" 2>/dev/null
  LEAKED=1
fi

# Check for files > 1MB (likely data, not code)
LARGE_FILES=$(find "$PUBLIC_DIR" -type f -size +1M -not -path '*/.git/*' -not -path '*/node_modules/*' -not -name '*.lock' 2>/dev/null || true)
if [ -n "$LARGE_FILES" ]; then
  echo "WARNING: Large files (>1MB) found - review these:"
  echo "$LARGE_FILES"
fi

if [ "$LEAKED" -eq 1 ]; then
  echo ""
  echo "ABORTING: Private files detected in public repo. Fix the exclusions above."
  exit 1
fi

echo "All clear - no private files detected."

# Step 3: Commit and push
cd "$PUBLIC_DIR"
git add -A

if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi

echo ""
echo "=== Changes to publish ==="
git diff --cached --stat

echo ""
read -p "Publish these changes to the public repo? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  git reset HEAD . > /dev/null 2>&1
  exit 0
fi

git commit -m "Sync from private repo ($(date +%Y-%m-%d))"
git push -u origin main
echo ""
echo "Published to https://github.com/moritzWa/personal-crm-public"
