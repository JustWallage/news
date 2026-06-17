terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket                      = "news-tfstate"
    key                         = "terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
    # endpoints.s3 is passed via -backend-config at init time because the
    # backend block cannot interpolate variables:
    #   terraform init -backend-config="endpoints={s3=\"https://<account>.r2.cloudflarestorage.com\"}"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# The custom domain + its Access app activate together, and only once the
# justwallage.nl zone id is supplied (which it is, from day one). A self_hosted
# Access app rejects a workers.dev hostname, so it is gated on the zone id.
locals {
  custom_domain_active = var.custom_domain != null && var.custom_domain_zone_id != null
  app_hostname         = local.custom_domain_active ? var.custom_domain : "news.${var.workers_dev_subdomain}"
}

resource "cloudflare_d1_database" "prod" {
  account_id = var.cloudflare_account_id
  name       = "news-prod"
  read_replication = {
    mode = "disabled"
  }
}

# --- Cloudflare Access (Zero Trust) ---

resource "cloudflare_zero_trust_access_identity_provider" "google" {
  account_id = var.cloudflare_account_id
  name       = "Google"
  type       = "google"

  config = {
    client_id     = var.google_client_id
    client_secret = var.google_client_secret
  }
}

resource "cloudflare_zero_trust_access_application" "news" {
  count = local.custom_domain_active ? 1 : 0

  account_id                = var.cloudflare_account_id
  name                      = "news"
  domain                    = var.custom_domain
  type                      = "self_hosted"
  session_duration          = "730h"
  auto_redirect_to_identity = true
  app_launcher_visible      = true
  allowed_idps              = [cloudflare_zero_trust_access_identity_provider.google.id]

  policies = [{
    name     = "Allow owner only"
    decision = "allow"
    include = [
      { email = { email = "just@wallage.nl" } },
    ]
  }]
}

# NOTE: the Workers custom domain (news.justwallage.nl → the worker) is created
# by wrangler at deploy time, NOT here. Terraform runs before the worker exists,
# so a cloudflare_workers_custom_domain resource 404s on the first deploy. See
# wrangler.jsonc (production env `routes`). This Access app only guards the
# hostname and has no dependency on the worker.
