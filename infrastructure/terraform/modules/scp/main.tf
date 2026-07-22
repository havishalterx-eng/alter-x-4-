resource "aws_organizations_policy" "this" {
  name        = var.name
  description = var.description
  type        = "SERVICE_CONTROL_POLICY"
  content     = var.policy

  tags = {
    Name = var.name
  }
}

resource "aws_organizations_policy_attachment" "this" {
  for_each = var.target_ids

  policy_id = aws_organizations_policy.this.id
  target_id = each.value
}
