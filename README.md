---
type: Guide
title: 共通state基盤の導入と運用
description: 非公開R2バケットを初期化し、stateのロックとアクセス権限を確認する手順。
sources:
  - id: r2-tokens
    resource: https://developers.cloudflare.com/r2/api/tokens/
  - id: state-lock
    resource: https://developer.hashicorp.com/terraform/language/backend/s3
---

## 管理範囲

`.infra`は非公開R2バケット4個をTerraformで管理します。各サイトのstate内容は各サイトが所有します。アカウントとバケット名はTerraformのlocalsに定義し、作成済みバケットは`import`ブロックで初回apply時に取り込みます。[管理契約](docs/adr/0001-r2-state.md)を参照してください。

自作JavaScript、Node.js、pnpmは使用しません。Terraform 1.16.3とCloudflare provider 5.25.0を固定し、Terraformの実行は検証・整形・lock更新を含めすべてGitHub Actionsで行います。

## 初期投入する資格情報

R2の利用登録と規約同意は利用者が行います。Standard無料枠内を基本とし、超過が見込まれる変更は適用前に確認します。

| Environment `foundation-operations`のSecret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 対象accountのWorkers R2 Storage Write。バケット設定用 |
| `R2_ACCESS_KEY_ID` | foundationバケット限定Object Read & WriteのAccess Key ID |
| `R2_SECRET_ACCESS_KEY` | 同じS3資格情報のSecret Access Key |

state用の資格情報はバケット単位に分離します。Object Read & Writeはprefix単位の分離ではありません。[^r2-tokens]

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo daiksudme/.infra --env foundation-operations
gh secret set R2_ACCESS_KEY_ID --repo daiksudme/.infra --env foundation-operations
gh secret set R2_SECRET_ACCESS_KEY --repo daiksudme/.infra --env foundation-operations
```

Environmentはmain限定・管理者bypass無効です。Required reviewersは設定せず、通常の適用に承認操作を要求しません。初期作成と設定の更新は管理権限を持つ`gh`認証で行い、branch policyは未作成の場合だけ追加します。

```sh
gh api repos/daiksudme/.infra/environments/foundation-operations --method PUT --input .github/foundation-environment.json
gh api repos/daiksudme/.infra/environments/foundation-operations/deployment-branch-policies --method POST --input .github/foundation-branch.json
```

## PRのplanとmainのapply

mainへのpushでVerifyが成功すると、Foundationが同じSHAでplan・apply・再planを自動実行します。差分なしならapplyを省略します。PRではPR foundationが最新コミットへ`terraform-plan`を報告します。daiksudが同repoのブランチから作成し、最新mainを含む検証済みPRだけ実planします。他の投稿者・forkは資格情報を使わず失敗として報告し、必要ならdaiksudが管理ブランチへ取り込んでPRを作成します。

手動のplan/applyも維持します。

```sh
gh workflow run foundation.yml --repo daiksudme/.infra --ref main -f operation=plan
gh workflow run foundation.yml --repo daiksudme/.infra --ref main -f operation=apply
gh run list --repo daiksudme/.infra --workflow foundation.yml
```

mainの適用とPRのplanは共通のfoundation-stateで排他します。PRはapplyせず、実行前後に投稿者・head・mainを照合します。

初回applyにバケットのimportも含まれます。独立したimport操作はありません。再実行時の取り込み済み判定はTerraformが行います。applyは同じジョブで生成した保存planを使い、直前に最新mainを照合します。

標準の`use_lockfile`と`prevent_destroy`、workflowの`foundation-state`排他を使います。バックアップと独自の実ロック・アクセス拒否試験は設けません。[^state-lock]

planは差分の有無だけを表示します。本文・バイナリ・state・診断ログはrunner内の非公開作業場所だけで扱い、ログやartifactへ公開しません。失敗・中断を成功扱いせず、再確認もActionsから行います。

## 検証とメンテナンス

PRとmain pushの`Verify`でfmt・validate・native mock testを実行します。ローカルではTerraformを実行しません。

```sh
gh workflow run verify.yml --repo daiksudme/.infra --ref main -f operation=check
gh workflow run verify.yml --repo daiksudme/.infra --ref main -f operation=format
gh workflow run verify.yml --repo daiksudme/.infra --ref main -f operation=lock
```

`format`と`lock`は変更されたTerraformソース／provider lockfileの差分だけを`terraform-maintenance` artifactへ保存します。`gh run download`で取得してPRへ取り込みます。stateやplanは含めません。Secretsは使用しません。mock成功は実環境の実行成功とは区別します。

[^r2-tokens]: Cloudflare公式のR2資格情報とバケット制限。
[^state-lock]: Terraform S3 backendの標準排他ロック。

## PRの承認とmain保護

CODEOWNERSはdaiksudです。mainのRulesetによるPR・承認1件・Code Ownerレビュー・必須検証・未解決スレッド解消の必須化は、所有者本人のPRが標準ルールでマージ可能になることを実PRで確認してから完了とします。Rulesetの定義・実適用はこの自動承認workflowの導入と分け、条件不成立時にbypassや独自の承認方式へ切り替えません。

GitHub Actionsの「Allow GitHub Actions to create and approve pull requests」を有効にします。Owner approvalはmainのコードからメタデータだけを読み、daiksudの非Draft PRの最新SHAについて`.github/required-checks.json`の検証成功後にApproveします。別の投稿者や失敗・未実行の検証は承認しません。実設定の適用とCode Owner本人のPRのマージ可否は、CIとは別に実PRで確認します。

自動Approveは、管理者本人が投稿したPRのCI結果に基づく承認です。VerifyはPR内のworkflow・テスト変更も検証対象として実行し、所有者による検証定義の変更を禁止しません。独立した内容レビューの代わりにはせず、変更のレビュー・必須CI・未解決指摘の確認を統合前に行います。承認処理自体はmainのコードから実行し、最新mainを含まないPRや承認直前に対象ブランチが変わったPRを拒否します。

GitHubのreview作成APIはHEAD一致を条件とする書込を提供しないため、自動承認前にmainの実Rulesetで古い承認の無効化（dismiss_stale_reviews_on_push）が有効であることを確認します。保護がない場合はApproveしません。

承認前にはstrictな必須チェックも確認し、main更新後の未検証状態でマージできないようにします。投稿したreviewのIDを取得してHEAD・対象・mainを再確認し、途中変更や確認失敗があればそのreviewを取り消して失敗にします。
