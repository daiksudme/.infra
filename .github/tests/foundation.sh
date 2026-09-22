#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
# Exercise guard decisions with fake CLI data, never run Terraform locally.
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
export FIXTURES=$WORK GITHUB_REPOSITORY=daiksudme/.infra GITHUB_REF=refs/heads/main
export GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cat > "$WORK/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
case "$2" in
 */git/ref/heads/main) echo "${MAIN_SHA:-$GITHUB_SHA}" ;;
 */pulls/7) cat "$FIXTURES/pr.json" ;;
 */compare/*) echo "$GITHUB_SHA" ;;
 *) exit 1 ;;
esac
GH
chmod +x "$WORK/gh"
export PATH="$WORK:$PATH"
printf '{"state":"open","user":{"login":"daiksud","id":155234749},"base":{"ref":"main","repo":{"full_name":"daiksudme/.infra"}},"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","repo":{"full_name":"daiksudme/.infra"}}}' > "$WORK/pr.json"
bash "$ROOT/.github/scripts/foundation-guard.sh"
if MAIN_SHA=old bash "$ROOT/.github/scripts/foundation-guard.sh"; then exit 1; fi
PR_NUMBER=7 PR_HEAD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb bash "$ROOT/.github/scripts/foundation-guard.sh"
for change in '.user.login = "contributor"' '.head.repo.full_name = "contributor/fork"' '.head.sha = "old"' '.state = "closed"'; do
 cp "$WORK/pr.json" "$WORK/valid.json"; jq "$change" "$WORK/valid.json" > "$WORK/pr.json"
 if PR_NUMBER=7 PR_HEAD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb bash "$ROOT/.github/scripts/foundation-guard.sh"; then exit 1; fi
 mv "$WORK/valid.json" "$WORK/pr.json"
done
echo 'Foundation source and SHA guards passed.'
