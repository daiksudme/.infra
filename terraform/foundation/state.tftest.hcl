mock_provider "cloudflare" {}

override_resource {
  target = cloudflare_r2_bucket.state["foundation"]
  values = {
    id = "daiksudme-tfstate-foundation"
    name = "daiksudme-tfstate-foundation"
    account_id = "a1f28decfde7c9df1884714e574d2059"
    storage_class = "Standard"
    jurisdiction = "default"
  }
}

override_resource {
  target = cloudflare_r2_bucket.state["domains"]
  values = {
    id = "daiksudme-tfstate-domains"
    name = "daiksudme-tfstate-domains"
    account_id = "a1f28decfde7c9df1884714e574d2059"
    storage_class = "Standard"
    jurisdiction = "default"
  }
}

override_resource {
  target = cloudflare_r2_bucket.state["family"]
  values = {
    id = "daiksudme-tfstate-family"
    name = "daiksudme-tfstate-family"
    account_id = "a1f28decfde7c9df1884714e574d2059"
    storage_class = "Standard"
    jurisdiction = "default"
  }
}

override_resource {
  target = cloudflare_r2_bucket.state["apex"]
  values = {
    id = "daiksudme-tfstate-apex"
    name = "daiksudme-tfstate-apex"
    account_id = "a1f28decfde7c9df1884714e574d2059"
    storage_class = "Standard"
    jurisdiction = "default"
  }
}

run "initial_import" {
  command = apply
  assert {
    condition = length(cloudflare_r2_bucket.state) == 4 && alltrue([for bucket in cloudflare_r2_bucket.state : bucket.id == bucket.name])
    error_message = "All four named buckets must be present under their imported identities."
  }
  assert {
    condition = alltrue([for domain in cloudflare_r2_managed_domain.private : domain.enabled == false])
    error_message = "State buckets must remain private."
  }
}
run "repeated_plan" {
  command = plan
  assert {
    condition = alltrue([for bucket in cloudflare_r2_bucket.state : bucket.id == bucket.name && bucket.storage_class == "Standard"])
    error_message = "A subsequent plan must preserve the same bucket identities."
  }
}
