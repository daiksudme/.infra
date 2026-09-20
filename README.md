---
type: Guide
title: 共通state基盤の導入と運用
description: 非公開R2バケットを初期化し、stateのロック・バックアップ・復元を確認する手順。
sources:
  - id: r2-tokens
    resource: https://developers.cloudflare.com/r2/api/tokens/
  - id: state-lock
    resource: https://developer.hashicorp.com/terraform/language/backend/s3
---

## 管理範囲

`.infra`はR2の保管基盤を所有します。`config.json`がCloudflareアカウントと4つのバケット名の正本です。各サイトのWorkerやアプリのstate内容は各サイトが所有します。[管理契約](docs/adr/0001-r2-state.md)を参照してください。

このリポジトリのCIは秘密値なしで単体・Terraform mock検証を行います。R2の実検証と通常applyは利用登録・資格情報の準備後に行います。family認証、DNS、Custom Domainはまだ管理しません。

## ローカル検証

```sh
mise trust mise.toml
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm test
mise exec -- terraform fmt -check -recursive
mise exec -- terraform -chdir=terraform/foundation init -backend=false -lockfile=readonly
mise exec -- terraform -chdir=terraform/foundation validate
mise exec -- terraform -chdir=terraform/foundation test
```

Node.js 24.21.0、pnpm 12.5.1、Terraform 1.16.3をmiseで選択します。依存とproviderはlockfileで固定します。mock成功は実際のR2互換性の証明ではありません。

## 初期投入する資格情報

R2は利用登録と規約への同意が必要です。Standardの無料枠内を基本とし、超過は従量課金になります。契約の変更・費用発生の判断は利用者が行います。

| 用途 | 必要な権限と保存先 |
| --- | --- |
| バケット作成・Terraform設定 | 対象accountだけのWorkers R2 Storage Write。ローカルの`.private/r2-admin.json`へ`CLOUDFLARE_API_TOKEN`として保存 |
| foundationのstate操作 | foundationバケットだけのObject Read & Write。`.private/foundation.json`へ`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY`として保存 |
| apexのstate操作 | apexバケットだけの別のObject Read & Write資格情報。apex側で管理し、通常のアプリ配信へ渡さない |
| foundation日次backup | GitHub Environment `state-foundation`の`R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`。foundationのS3資格情報を使用 |

R2のS3資格情報はバケット作成後に、対象バケットを限定して作成します。通常のS3資格情報でバケット設定の変更は行いません。R2のObject Read & Writeはバケット内の現行state・lockも変更可能なので、prefix単位に権限が分離できているとは扱いません。[^r2-tokens]

JSONファイルは環境変数名と秘密値の文字列の対応だけを持たせ、ディレクトリを0700、ファイルを0600にします。秘密値をチャット、Git、公開ログへ貼りません。`with-secrets.mjs`はJSONを環境変数へ読み、シェルとして評価しません。

## バケット作成とimport

まず対象一覧だけを確認します。このコマンドはAPIを呼びません。

```sh
mise exec -- node scripts/bootstrap.mjs
```

R2登録と管理トークンの投入後に実行します。

```sh
mise exec -- node scripts/with-secrets.mjs .private/r2-admin.json node scripts/bootstrap.mjs --apply
```

作成ごとに`.private/bootstrap-receipt.json`へaccount・バケット名・作成日時を保存します。既存バケットはreceiptと一致しなければ拒否します。receipt紛失、作成直後の応答消失、バケット再作成を自動的に「所有済み」と扱いません。実際の所有元を確認してから復旧してください。

foundation限定S3資格情報を用意し、実際のTerraform排他を先に確認します。使い捨ての`validation/`キーにだけstateを書き、別applyとの競合と正常なlock解放を確認します。[^state-lock]

```sh
mise exec -- node scripts/with-secrets.mjs .private/foundation.json node scripts/verify-lock.mjs foundation
mise exec -- node scripts/with-secrets.mjs .private/foundation.json terraform -chdir=terraform/foundation init -reconfigure
```

管理トークンとfoundation S3資格情報を合わせた、owner-onlyの`.private/foundation-iac.json`を用意します。各バケットを一度ずつimportします。すでにimport済みのものは重ねてimportしません。

```sh
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json terraform -chdir=terraform/foundation import 'cloudflare_r2_bucket.state["foundation"]' 'a1f28decfde7c9df1884714e574d2059/daiksudme-tfstate-foundation/default'
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json terraform -chdir=terraform/foundation import 'cloudflare_r2_bucket.state["domains"]' 'a1f28decfde7c9df1884714e574d2059/daiksudme-tfstate-domains/default'
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json terraform -chdir=terraform/foundation import 'cloudflare_r2_bucket.state["family"]' 'a1f28decfde7c9df1884714e574d2059/daiksudme-tfstate-family/default'
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json terraform -chdir=terraform/foundation import 'cloudflare_r2_bucket.state["apex"]' 'a1f28decfde7c9df1884714e574d2059/daiksudme-tfstate-apex/default'
```

foundationのstateはこの時点からR2へ保存されます。lock/lifecycle/r2.dev設定はproviderがimportをサポートしないため、初回planで作成・管理します。

## planとapply

```sh
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json terraform -chdir=terraform/foundation plan -out=../../.private/foundation.tfplan > .private/plan.log 2>&1
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json node scripts/state.mjs apply foundation .private/foundation.tfplan
```

planはローカルの保護された作業場所で確認します。公開のCIログやartifactへアップロードしません。`TF_DATA_DIR`・`TF_CLI_ARGS*`による実行環境の上書きは拒否します。applyは選択中のworkspaceが`default`であること、同じbackend・ロック検証記録を確認し、削除・無関係なリソース・公開設定・保持期間の変更を拒否します。適用前のbackup失敗ではapplyせず、適用失敗時も部分更新後のstateをbackupします。適用ログは`.private/`だけに残します。

現行state・`.tflock`は上書き・削除できなければTerraformが動かないため、保持ロック対象にしません。`backups/日付/lineage/serial-hash.tfstate`だけを30日保護し、90日で削除します。同一日の同一内容は再利用し、内容が異なる既存backupは拒否します。

## 実環境の保全検証と日次backup

```sh
mise exec -- node scripts/with-secrets.mjs .private/foundation-iac.json node scripts/verify-state.mjs foundation
mise exec -- node scripts/configure-backup.mjs prepare
```

保全検証は匿名アクセス拒否、他の3バケットへのアクセス拒否、使い捨てstateのbackup保護・復元を確認します。保持ロックを確認するため、小さなテストbackupは残り、90日lifecycleで削除されます。実際の現行stateを破壊・復元する試験ではありません。

`prepare`はGitHubの既存認証でmain限定Environmentを用意します。既存の保護が異なる場合は上書きせず停止します。利用者がEnvironmentへS3秘密値を登録し、両実検証が成功した後だけ有効化します。

```sh
mise exec -- node scripts/configure-backup.mjs enable
```

日次backupはUTC 02:23に実行し、applyがなくても90日分の世代を維持します。失敗時はActionsの通知と実行結果を確認してください。apex側も自分のバケット限定資格情報で同じ日次保全を行い、共通stateへアクセスしません。family向け運用は別途準備します。

`.private/`の検証記録は再実行を防ぐためのローカル記録であり、署名付きの証明ではありません。Issueには実行結果・対象版・時刻を記録し、ファイルの存在だけで実検証済みと扱いません。

[^r2-tokens]: Cloudflare公式のR2資格情報とバケット制限。
[^state-lock]: Terraform公式S3 backend。R2との実互換性は使い捨てstateによる排他試験で確認する。
