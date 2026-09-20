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
}
