# Terraform Coding Standards

Reference for generating `ai/instructions/devops.md` in projects using Terraform.

## Version Pinning

Pin both Terraform itself and every provider. Unpinned versions silently break on upgrade.

```hcl
# DO — pin to patch-level precision: ~> X.Y.Z allows only X.Y.* patches
terraform {
  required_version = "~> 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6.0"
    }
  }
}

# DON'T — no version pin, or two-segment form that allows unintended minor bumps
# ~> 1.7 means >= 1.7, < 2.0 — permits 1.8, 1.9, etc.
# ~> 5.40 means >= 5.40, < 6.0 — permits 5.41, 5.42, etc.
terraform {
  required_version = "~> 1.7"   # permits 1.8, 1.9 — too loose for reproducible infra

  required_providers {
    aws = { source = "hashicorp/aws" }   # no version = whatever is installed
  }
}
```

- `~> X.Y.Z` (three-segment) locks to patch upgrades only: `~> 5.40.0` permits 5.40.1 but blocks 5.41.0.
- `~> X.Y` (two-segment) permits all minor and patch upgrades within the major — use only if you actively want that range.
- Commit `.terraform.lock.hcl`. It pins provider checksums across platforms and CI.

## Remote State

Never store state in git. Use remote state with locking from the first commit.

```hcl
# DO — S3 backend with DynamoDB locking
terraform {
  backend "s3" {
    bucket         = "my-tfstate-prod"
    key            = "services/api/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}
```

- `encrypt = true` encrypts state at rest. State files often contain secrets (database passwords, private keys).
- One state file per environment and service. Never share state across environments.
- Never run `terraform force-unlock` without first confirming the lock owner process is dead.

## Secrets and Variables

```hcl
# DO — mark secrets as sensitive
variable "db_password" {
  type      = string
  sensitive = true   # suppresses value in plan/apply output — NOT in state file
}

# DO — pass secrets via environment variables, never in tfvars committed to git
# TF_VAR_db_password=hunter2 terraform apply
```

```hcl
# DON'T — hardcode secrets
resource "aws_db_instance" "main" {
  password = "hunter2"   # committed to state and git history
}

# DON'T — store secrets in tfvars committed to git
# terraform.tfvars:
# db_password = "hunter2"
```

- Use `sensitive = true` on any variable or output containing credentials, tokens, or keys. It suppresses values in terminal output and `terraform output` — but secrets are **still stored in plaintext in state**. Treat state files as secrets.
- Pull secrets from a secrets manager at apply time: `data "aws_secretsmanager_secret_version"`.
- Add `*.tfvars` and `*.tfvars.json` to `.gitignore`. Provide `terraform.tfvars.example` with placeholder values.

## Module Structure

```
modules/
  vpc/
    main.tf
    variables.tf   # all inputs
    outputs.tf     # all outputs
    versions.tf    # required_providers
  rds/
    ...
environments/
  prod/
    main.tf        # calls modules
    variables.tf
    terraform.tfvars  # gitignored
```

- Each module has `variables.tf`, `outputs.tf`, and `versions.tf` — never mix them into `main.tf`.
- Validate variables where the contract matters:

```hcl
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}
```

## Resource Lifecycle and Destruction Protection

```hcl
# DO — protect stateful resources from accidental destruction
resource "aws_rds_cluster" "main" {
  ...
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [engine_version]  # managed outside Terraform (RDS auto-minor-upgrade)
  }
}

# DO — safe replacement ordering for resources that can't have downtime
resource "aws_instance" "app" {
  ...
  lifecycle {
    create_before_destroy = true
  }
}
```

- Set `prevent_destroy = true` on databases, S3 buckets with live data, and KMS keys.
- Never use `terraform destroy` in production without a saved plan reviewed by a second person.

## Plan Safety

```bash
# DO — save and review the plan before applying
terraform plan -out=tfplan
terraform show tfplan           # review in CI artifact or locally
terraform apply tfplan          # apply exactly what was reviewed

# DON'T — apply without reviewing the plan
terraform apply -auto-approve   # skips plan review entirely
```

- In CI, always run `terraform plan` on PR and `terraform apply` only on merge to main.
- Use `-target` only for emergency break-glass situations. Targeted applies create state drift.
- Run `terraform validate` and `tflint` in CI before plan. Fail on any `tflint` errors.

## IAM Least Privilege

```hcl
# DO — narrow resource ARNs and specific actions
resource "aws_iam_policy" "app" {
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = ["${aws_s3_bucket.uploads.arn}/*"]
    }]
  })
}

# DON'T — wildcard actions or resources
resource "aws_iam_policy" "app_bad" {
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["*"]
      Resource = ["*"]
    }]
  })
}
```

- One IAM role per service. Never share roles across services with different trust levels.
- Run `checkov` or `tfsec` in CI to catch overly permissive IAM policies automatically.

## Common Footguns

- **State in git**: state files contain secrets in plaintext. Always use a remote backend.
- **`-auto-approve` in CI**: bypasses plan review. Use saved plan files (`-out`) and apply them in a separate step.
- **`prevent_destroy = false` on databases**: a single typo or module rename triggers a drop-and-recreate. Default stateful resources to `prevent_destroy = true`.
- **`sensitive = false` on secret outputs**: unmarked outputs appear in `terraform output` and CI logs. Mark all credential outputs as `sensitive = true`.
- **Unlocked `.terraform.lock.hcl` not committed**: without it, different machines or CI agents resolve different provider versions, causing silent drift.
- **`-target` in routine applies**: leaves state inconsistent with config. Other resources that depend on the targeted resource may drift silently.
- **Provider credentials in environment with broad scope**: if `AWS_ACCESS_KEY_ID` has `*`/`*` permissions, a plan or apply leak exposes full account access.
