#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
export FIXTURES=$WORK GITHUB_REPOSITORY=daiksudme/.infra GITHUB_EVENT_NAME=pull_request_target
export GITHUB_EVENT_PATH=$WORK/event.json
printf '{"pull_request":{"number":7}}' > "$GITHUB_EVENT_PATH"
cat > "$WORK/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
case "$2" in
 */pulls/7)
   [[ ${FAIL_API:-0} == 0 ]] || exit 1
   if [[ ${RACE:-0} == 1 && -f "$FIXTURES/read" ]]; then jq '.head.sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' "$FIXTURES/pr.json"; else cat "$FIXTURES/pr.json"; fi
   touch "$FIXTURES/read" ;;

 */check-runs*) cat "$FIXTURES/checks.json" ;;
 */reviews*) if [[ $* == *APPROVE* ]]; then touch "$FIXTURES/approved"; else echo '[]'; fi ;;
 *) exit 1 ;;
esac
GH
chmod +x "$WORK/gh"
export PATH="$WORK:$PATH"
valid() {
 rm -f "$WORK/approved" "$WORK/read"
 printf '{"state":"open","draft":false,"user":{"login":"daiksud","id":155234749},"base":{"ref":"main","repo":{"full_name":"daiksudme/.infra"}},"head":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}' > "$WORK/pr.json"
 printf '{"check_runs":[{"id":2,"name":"verify","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","app":{"id":15368}}]}' > "$WORK/checks.json"
}
valid
bash "$ROOT/.github/scripts/approve.sh"
test -f "$WORK/approved"
for change in '.draft = true' '.user.login = "contributor"' '.state = "closed"' '.base.ref = "other"'; do
 valid; jq "$change" "$WORK/pr.json" > "$WORK/next"; mv "$WORK/next" "$WORK/pr.json"
 bash "$ROOT/.github/scripts/approve.sh"
 test ! -f "$WORK/approved"
done
for change in '.check_runs[0].conclusion = "failure"' '.check_runs = []' '.check_runs[0].app.id = 1' '.check_runs[0].head_sha = "old"' '.check_runs[0].status = "in_progress"'; do
 valid; jq "$change" "$WORK/checks.json" > "$WORK/next"; mv "$WORK/next" "$WORK/checks.json"
 bash "$ROOT/.github/scripts/approve.sh"
 test ! -f "$WORK/approved"
done
valid
# Use an isolated copy so this test never edits the checkout.
mkdir -p "$WORK/repo/.github/scripts"
cp "$ROOT/.github/scripts/approve.sh" "$WORK/repo/.github/scripts/approve.sh"
printf '[]' > "$WORK/repo/.github/required-checks.json"
if bash "$WORK/repo/.github/scripts/approve.sh"; then echo 'Empty checks were accepted' >&2; exit 1; fi
test ! -f "$WORK/approved"
for condition in RACE FAIL_API; do
 valid
 if env "$condition=1" bash "$ROOT/.github/scripts/approve.sh"; then echo 'Concurrent push or API failure was accepted' >&2; exit 1; fi
 test ! -f "$WORK/approved"
done
echo 'Approval eligibility cases passed.'
