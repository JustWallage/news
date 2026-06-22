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

resource "cloudflare_d1_database" "prod" {
  account_id = var.cloudflare_account_id
  name       = "news-prod"
  read_replication = {
    mode = "disabled"
  }
}

# Authentication is handled in the Worker (Google OAuth + sessions), not by
# Cloudflare Access — there are no Access resources here. The Workers custom
# domain (news.justwallage.nl → the worker) is created by wrangler at deploy
# time, NOT here: Terraform runs before the worker exists. See wrangler.jsonc
# (production env `routes`).
