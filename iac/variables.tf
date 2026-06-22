variable "cloudflare_api_token" {
  description = "Cloudflare API token (Workers, D1, R2, Workers AI)"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id"
  type        = string
}
