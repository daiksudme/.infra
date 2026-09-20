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

Terraform 1.16.3、Cloudflare provider 5.25.0を固定する。Node.js・pnpm・Terraformはmiseで導入する。実ロックとアクセス権限の検証はAWS SDK v3の固定版をS3互換クライアントとして使い、AWSのリソースやアカウントは作らない。

R2のバケットをstateごとに分離し、各S3資格情報を一つのバケットへ限定する。r2.devは無効、Custom Domainは作らない。相手のstateをremote_stateで参照しない。

S3 backendのuse_lockfileを有効にする。R2には条件付きPutObjectがあるが、仕様の一致だけでTerraformの実互換性を保証せず、並行applyの拒否と解放を実測してから通常applyへ進む。[^r2-compatibility] [^terraform-s3]

stateはR2の現行データだけを管理する。独自のバックアップ、世代保存、保持ロック、lifecycle、日次ジョブは設けない。Terraformの排他ロックは維持する。

## 初回構築と変更

bootstrapは必要なバケットだけを作り、作成日時をreceiptへ保存する。未知の同名バケット、receiptと不一致のバケット、公開されたバケットを勝手に取り込まない。

foundation backendへ直接initし、作成済みバケットをimportする。stateをGitで中継しない。以後は保存済みplan・backend・workspace・排他の前提を検査してapplyする。失敗終了を保持し、公開ログへstateやplanを出さない。

検証はvalidation/の使い捨てデータで実施する。実stateを書き換えず、force-unlockや強制state pushを自動実行しない。

## 実装と検証の境界

この契約はapexに必要な保管基盤を対象にする。familyのGoogle認証・個別Allow・Access、DNS・Custom Domainは変更しない。.infra #2・#3のfamily向け未完了条件は残す。

単体テストとTerraform mockは実環境の代用ではない。R2の利用登録・バケット限定資格情報の投入後、匿名拒否・他state拒否・ロック・使い捨てデータの読書きを確認して結果を記録する。設定・CLI/provider版や権限が変わった場合は関連する実検証をやり直す。

## 決定の更新

2026-09-21: 初期構成を簡素化するため、当初の世代別バックアップ・30日保持ロック・90日保存を採用対象から外した。R2 Bucket locks[^r2-locks]は使用せず、state保存とTerraformの排他を維持する。

[^r2-compatibility]: R2のS3 API対応表。条件付きPutObjectを参照。
[^terraform-s3]: Terraform S3 backendのuse_lockfileと必要な権限。
[^r2-locks]: R2 Bucket locksのprefix・保持期間・lifecycleとの優先関係。
