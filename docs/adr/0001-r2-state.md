---
type: Decision
title: R2で分離したstateと世代別バックアップを管理する
description: apexの配信基盤に必要なstate保管・権限・復旧の契約。
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

基盤担当者はstateを公開せずに変更・復旧でき、apex担当者は共通stateを読むことなく自分のWorkerを管理できる。
`.infra`が保管基盤、各サイトがstate内容を所有する。[apexの管理契約](https://github.com/daiksudme/apex/blob/main/docs/adr/0001-delivery-ownership.md)と整合させる。

| state | 所有する構成 | バケット |
| --- | --- | --- |
| foundation | .infraのR2基盤 | daiksudme-tfstate-foundation |
| domains | .infraのDNS・接続（未実装） | daiksudme-tfstate-domains |
| family | familyのWorker・Access（未実装） | daiksudme-tfstate-family |
| apex | apexのWorker・GitHub設定 | daiksudme-tfstate-apex |

Cloudflareのdaiksudアカウントを使い、Standardの無料枠内を基本とする。利用登録と規約同意、初期秘密値の投入は利用者が行う。R2の超過料金をゼロと保証せず、費用が必要になる変更は事前確認する。

## 決定

Terraform 1.16.3、Cloudflare provider 5.25.0を固定する。Node.js・pnpm・Terraformはmiseで導入する。バックアップはAWS SDK v3の固定版をS3互換クライアントとして使い、AWSのリソースやアカウントは作らない。

R2のバケットをstateごとに分離し、各S3資格情報を一つのバケットへ限定する。r2.devは無効、Custom Domainは作らない。相手のstateをremote_stateで参照しない。

S3 backendのuse_lockfileを有効にする。R2には条件付きPutObjectがあるが、仕様の一致だけでTerraformの実互換性を保証せず、並行applyの拒否と解放を実測してから通常applyへ進む。[^r2-compatibility] [^terraform-s3]

R2はS3 Bucket Versioningに対応しないため、apply前後と日次に独立した世代を保存する。日付・lineage・serial・内容ハッシュが保存先を決め、同名の異なる内容を上書きしない。backup対象の解析エラーに生のstateを含めない。[^r2-compatibility]

backups/だけ30日間上書き・削除禁止とし、90日で世代を削除する。現行stateと.tflockへ保持ロックを掛けない。ロックは既存オブジェクトにも適用され、lifecycleより優先される。[^r2-locks]

## 初回構築と復旧

bootstrapは必要なバケットだけを作り、作成日時をreceiptへ保存する。未知の同名バケット、receiptと不一致のバケット、公開されたバケットを勝手に取り込まない。

foundation backendへ直接initし、作成済みバケットをimportする。stateをGitで中継しない。以後は保存済みplanを確認し、backup付きapply経路を使う。失敗したapplyの部分更新もbackupする。

検証はvalidation/の使い捨てstateで実施する。本物のstateへの復元は、lineage・serial・対象リソースの現状を確認し、適用を停止した保護された作業として別途行う。force-unlockや強制state pushを自動実行しない。

## 実装と検証の境界

この契約はapexに必要な保管基盤を対象にする。familyのGoogle認証・個別Allow・Access、DNS・Custom Domainは変更しない。.infra #2・#3のfamily向け未完了条件は残す。

単体テストとTerraform mockは実環境の代用ではない。R2の利用登録・バケット限定資格情報の投入後、匿名拒否・他state拒否・ロック・保持・使い捨て復元を確認して結果を記録する。設定・CLI/provider版や権限が変わった場合は関連する実検証をやり直す。

[^r2-compatibility]: R2のS3 API対応表。条件付きPutObjectとBucket Versioning非対応を参照。
[^terraform-s3]: Terraform S3 backendのuse_lockfileと必要な権限。
[^r2-locks]: R2 Bucket locksのprefix・保持期間・lifecycleとの優先関係。
