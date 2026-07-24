resource "aws_organizations_account" "this" {
  name      = var.name
  email     = var.email
  parent_id = var.parent_id
  role_name = var.role_name

  close_on_deletion = false

  tags = {
    Name    = var.name
    purpose = var.purpose
  }

  lifecycle {
    prevent_destroy = true
  }
}
