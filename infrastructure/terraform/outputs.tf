output "account_ids" {
  description = "Account IDs keyed by the exact approved account name."
  value       = { for name, account in module.account : name => account.account_id }
}

output "scp_policy_ids" {
  description = "Created SCP policy IDs."
  value = {
    audit      = module.audit_guardrail.policy_id
    production = module.production_guardrail.policy_id
    region     = module.region_guardrail.policy_id
    root_user  = module.root_user_guardrail.policy_id
    sandbox    = module.sandbox_guardrail.policy_id
  }
}
