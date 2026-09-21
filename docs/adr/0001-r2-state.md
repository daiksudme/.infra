---
type: Decision
title: R2で分離したstateを管理する
description: apexの配信基盤に必要なstate保管・権限・排他の契約。
status: stable
decision_status: accepted
date: 2026-09-20
sources:
  - id: r2-compatibility
    resource: https://developers.cloudflare.com/r2/api/s3/api/
  - id: r2-locks
    resource: https://developers.cloudflare.com/r2/buckets/bucket-locks/
  - id: terraform-s3
    resource: https://developer.hashicorp.com/terraform/language/backend/s3
---

## 目的と所有

基盤担当者はstateを公開せずに変更でき、apex担当者は共通stateを読むことなく自分のWorkerを管理できる。
`.infra`が保管基盤、各サイトがstate内容を所有する。[apexの管理契約](https://github.com/daiksudme/apex/blob/main/docs/adr/0001-delivery-ownership.md)と整合させる。

| state | 所有する構成 | バケット |
| --- | --- | --- |
| foundation | .infraのR2基盤 | daiksudme-tfstate-foundation |
| domains | .infraのDNS・接続（未実装） | daiksudme-tfstate-domains |
| family | familyのWorker・Access（未実装） | daiksudme-tfstate-family |
| apex | apexのWorker・GitHub設定 | daiksudme-tfstate-apex |

Cloudflareのdaiksudアカウントを使い、Standardの無料枠内を基本とする。利用登録と規約同意、初期秘密値の投入は利用者が行う。R2の超過料金をゼロと保証せず、費用が必要になる変更は事前確認する。

## 決定

Terraform 1.16.3とCloudflare provider 5.25.0を固定する。TerraformはGitHub Actions上だけで実行し、公式setup-terraformのwrapperは無効にする。検証・整形・provider lock更新もActionsで行う。

4つの非公開バケットとバケット限定資格情報、S3 backendの`use_lockfile`、`prevent_destroy`を維持する。r2.devは無効、Custom Domainは作らず、共通stateを各サイトから参照しない。[^terraform-s3]

取り込みは固定account・バケット名に対応するTerraformの`import`ブロックで宣言する。初回applyと再実行の判定はTerraformに任せる。独自の所有日時照合・state解析・plan全属性検査・取り込みループは持たない。

main限定・承認必須Environment、workflowの排他、変更直前の最新main確認を使う。planの差分有無だけを公開し、本文・state・診断ログはrunner内で扱う。バックアップ、世代保存、保持ロック、lifecycle、日次ジョブは設けない。

## 検証と更新履歴

CIではTerraformのnative mock testと標準検証を行う。R2の条件付きPutObjectへの対応[^r2-compatibility]を前提に標準ロックを使用するが、専用の実競合・アクセス拒否試験は行わない。CI成功と実import/apply成功は分けて記録する。

2026-09-21: 初期案の30日保持・90日保存とR2 Bucket locks[^r2-locks]を採用対象から外した。その後、標準機能中心の構成へ変更し、自作JavaScript・毎回の実ロック／権限試験・検証証明ファイルも廃止した。

familyのアプリ認証、DNSとCustom Domainはこの変更に含めない。

[^terraform-s3]: Terraform S3 backendのuse_lockfile。
[^r2-compatibility]: R2のS3 API対応表。条件付きPutObjectを参照。
[^r2-locks]: 初期案で参照したR2 Bucket locks。現行構成では採用しない。
