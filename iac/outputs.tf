output "d1_database_id_prod" {
  description = "Production D1 database id (templated into wrangler config by CI)"
  value       = cloudflare_d1_database.prod.id
}

output "app_hostname" {
  description = "Hostname the app (and its Access application) is served on"
  value       = local.app_hostname
}
