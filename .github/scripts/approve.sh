#!/usr/bin/env bash
# This script runs from the trusted base branch and never checks out PR code.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
case "$GITHUB_EVENT_NAME" in
  pull_request_target) number=$(jq -er '.pull_request.number' "$GITHUB_EVENT_PATH") ;;
  workflow_run)
    number=$(jq -er '.workflow_run | select(.event == "pull_request" and .path == ".github/workflows/verify.yml" and .conclusion == "success") | .pull_requests | select(length == 1) | .[0].number' "$GITHUB_EVENT_PATH") || exit 0 ;;
  *) exit 1 ;;
esac
[[ $number =~ ^[1-9][0-9]*$ ]]
pr=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$number")
jq -e --arg repo "$GITHUB_REPOSITORY" 'select(.state == "open" and .draft == false and .user.login == "daiksud" and .user.id == 155234749 and .base.ref == "main" and .base.repo.full_name == $repo)' <<< "$pr" >/dev/null || exit 0
sha=$(jq -er '.head.sha | select(test("^[a-f0-9]{40}$"))' <<< "$pr")
[[ $GITHUB_SHA == "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" ]]
[[ $GITHUB_SHA == "$(gh api "repos/$GITHUB_REPOSITORY/compare/$GITHUB_SHA...$sha" --jq .merge_base_commit.sha)" ]]
if [[ $GITHUB_EVENT_NAME == workflow_run ]]; then
  [[ $sha == "$(jq -er '.workflow_run.head_sha' "$GITHUB_EVENT_PATH")" ]] || exit 0
fi
checks=$(gh api "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs?per_page=100")
required=$(jq -er 'select(type == "array" and length > 0 and all(.[]; type == "string" and length > 0)) | .[]' "$ROOT/.github/required-checks.json")
while IFS= read -r name; do
  jq -e --arg name "$name" --arg sha "$sha" '[.check_runs[] | select(.name == $name and .app.id == 15368 and .head_sha == $sha)] | sort_by(.id) | last | select(.status == "completed" and .conclusion == "success")' <<< "$checks" >/dev/null || exit 0
done <<< "$required"
# Review creation has no compare-and-swap option; require native stale-review protection.
gh api "repos/$GITHUB_REPOSITORY/rules/branches/main" | jq -e 'any(.[]; .type == "pull_request" and .parameters.dismiss_stale_reviews_on_push == true) and any(.[]; .type == "required_status_checks" and .parameters.strict_required_status_checks_policy == true)' >/dev/null
reviews=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$number/reviews?per_page=100")
if jq -e --arg sha "$sha" 'any(.[]; .user.login == "github-actions[bot]" and .state == "APPROVED" and .commit_id == $sha)' <<< "$reviews" >/dev/null; then exit 0; fi
# Re-read immediately before approving so a concurrent push cannot inherit approval.
gh api "repos/$GITHUB_REPOSITORY/pulls/$number" | jq -e --arg sha "$sha" --arg repo "$GITHUB_REPOSITORY" 'select(.state == "open" and .draft == false and .head.sha == $sha and .base.ref == "main" and .base.repo.full_name == $repo and .user.id == 155234749 and .user.login == "daiksud")' >/dev/null
[[ $GITHUB_SHA == "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" ]]
review=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$number/reviews" -f event=APPROVE -f commit_id="$sha" -f body='Required checks passed for this commit; owner-authored PR approved by policy.' --jq .id)
[[ $review =~ ^[0-9]+$ ]]
# Revoke a review created after a push/retarget; native rules cover subsequent updates.
if ! gh api "repos/$GITHUB_REPOSITORY/pulls/$number" | jq -e --arg sha "$sha" --arg repo "$GITHUB_REPOSITORY" 'select(.state == "open" and .draft == false and .head.sha == $sha and .base.ref == "main" and .base.repo.full_name == $repo)' >/dev/null || [[ $GITHUB_SHA != "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" ]]; then
  gh api "repos/$GITHUB_REPOSITORY/pulls/$number/reviews/$review/dismissals" --method PUT -f message='PR changed during approval; verification must run again.' >/dev/null
  exit 1
fi
