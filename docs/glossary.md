---
type: Glossary
title: state保管基盤の用語
description: 共通基盤の所有・排他・保全で使う語の意味。
---

| 用語 | 定義 | 境界 | コード上の名称 |
| --- | --- | --- | --- |
| state | Terraformの管理対象と実リソースの対応を保持する非公開データ | 各root module | terraform.tfstate |
| state lock | 同じstateへの並行適用を防ぐ、一時的な排他 | Terraform backend | .tflock、use_lockfile |
| backup保持ロック | 保存済み世代の上書き・削除を30日間拒否する保管規則 | R2 | cloudflare_r2_bucket_lock |
| bootstrap receipt | この処理が作ったバケットと作成日時の記録 | 初回構築 | bootstrap-receipt.json |
| 世代 | 日付・lineage・serial・内容ハッシュで特定するstateの写し | state保全 | backups/、backupState |
