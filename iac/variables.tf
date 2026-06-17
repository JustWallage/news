variable "cloudflare_api_token" {
  description = "Cloudflare API token (Workers, D1, R2, Access, Workers AI)"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id"
  type        = string
}

variable "workers_dev_subdomain" {
  description = "The account's workers.dev subdomain (the X in X.workers.dev)"
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth client id for the Access identity provider"
  type        = string
}

variable "google_client_secret" {
  description = "Google OAuth client secret for the Access identity provider"
  type        = string
  sensitive   = true
}

variable "custom_domain" {
  description = "App hostname on the justwallage.nl zone"
  type        = string
  default     = "news.justwallage.nl"
}

variable "custom_domain_zone_id" {
  description = "Cloudflare zone id for justwallage.nl. Supplied from day one so the custom domain and Access app activate on the first deploy; until it is set the app stays on workers.dev with no Access."
  type        = string
  default     = null
}
