#!/usr/bin/env bash
set -euo pipefail
[[ $GITHUB_REPOSITORY == daiksudme/.infra && $GITHUB_REF == refs/heads/main && $GITHUB_SHA =~ ^[a-f0-9]{40}$ ]]
[[ $GITHUB_SHA == "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" ]]
if [[ -n ${PR_NUMBER:-} ]]; then
  [[ $PR_NUMBER =~ ^[1-9][0-9]*$ && ${PR_HEAD:-} =~ ^[a-f0-9]{40}$ ]]
  gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" | jq -e --arg sha "$PR_HEAD" --arg repo "$GITHUB_REPOSITORY" 'select(.state == "open" and .user.login == "daiksud" and .user.id == 155234749 and .head.repo.full_name == $repo and .head.sha == $sha and .base.repo.full_name == $repo and .base.ref == "main")' >/dev/null
  [[ $GITHUB_SHA == "$(gh api "repos/$GITHUB_REPOSITORY/compare/$GITHUB_SHA...$PR_HEAD" --jq .merge_base_commit.sha)" ]]
fi
