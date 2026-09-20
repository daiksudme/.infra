mock_provider "cloudflare" {}

run "private_state_contract" {
  command = plan
  assert {
    condition     = length(cloudflare_r2_bucket.state) == 4
    error_message = "Each state needs its own bucket."
  }
  assert {
    condition     = alltrue([for domain in cloudflare_r2_managed_domain.private : domain.enabled == false])
    error_message = "State must not be exposed through r2.dev."
  }
  assert {
    condition     = alltrue([for lock in cloudflare_r2_bucket_lock.backups : lock.rules[0].prefix == "backups/" && lock.rules[0].condition.max_age_seconds == 2592000])
    error_message = "Only backups are locked for 30 days; state and .tflock must remain writable."
  }
  assert {
    condition     = alltrue([for rule in cloudflare_r2_bucket_lifecycle.backups : rule.rules[0].conditions.prefix == "backups/" && rule.rules[0].delete_objects_transition.condition.max_age == 7776000])
    error_message = "Only backup snapshots expire after 90 days."
  }
}
