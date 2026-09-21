terraform {
  required_version = "= 1.16.3"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.25.0"
    }
  }
  backend "s3" {
    bucket                      = "daiksudme-tfstate-foundation"
    key                         = "terraform.tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://a1f28decfde7c9df1884714e574d2059.r2.cloudflarestorage.com" }
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

locals {
  account_id = "a1f28decfde7c9df1884714e574d2059"
  buckets = {
    foundation = "daiksudme-tfstate-foundation"
    domains    = "daiksudme-tfstate-domains"
    family     = "daiksudme-tfstate-family"
    apex       = "daiksudme-tfstate-apex"
  }
}

resource "cloudflare_r2_bucket" "state" {
  for_each      = local.buckets
  account_id    = local.account_id
  name          = each.value
  storage_class = "Standard"
  jurisdiction  = "default"
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_managed_domain" "private" {
  for_each    = cloudflare_r2_bucket.state
  account_id  = local.account_id
  bucket_name = each.value.name
  enabled     = false
}

import {
  for_each = local.buckets
  to       = cloudflare_r2_bucket.state[each.key]
  id       = "${local.account_id}/${each.value}/default"
}
