# Packer Coding Standards

Reference for generating `ai/instructions/devops.md` in projects using Packer.

## Template Format

Use HCL2 format (`.pkr.hcl`). JSON format (`.json`) is legacy and lacks variables, locals, and functions.

```hcl
# DO - HCL2 with typed variables
variable "ami_name" {
  type    = string
  default = "myapp-{{timestamp}}"
}

source "amazon-ebs" "web" {
  ami_name      = var.ami_name
  instance_type = "t3.micro"
  source_ami_filter {
    filters = {
      name                = "ubuntu/images/*ubuntu-jammy-22.04-amd64-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    owners      = ["099720109477"]
    most_recent = true
  }
  ssh_username = "ubuntu"
}
```

## Build Blocks

- One `build` block per template. Multiple `source` blocks are fine for multi-platform images.
- Use `provisioner` blocks sparingly. Prefer pre-baked AMIs over runtime provisioning.
- Order provisioners: package install, configuration, cleanup, validation.

```hcl
build {
  sources = ["source.amazon-ebs.web"]

  provisioner "shell" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y nginx",
    ]
  }

  provisioner "shell" {
    inline = ["sudo apt-get clean", "sudo rm -r /var/cache/apt"]
  }
}
```

## Variables and Locals

- Type every variable. Use `validation` blocks for constraints.
- Use `locals` for computed values, not variables with complex defaults.
- Sensitive variables: mark with `sensitive = true` to prevent logging.

```hcl
variable "vpc_id" {
  type        = string
  description = "VPC to launch the instance in"
  validation {
    condition     = can(regex("^vpc-", var.vpc_id))
    error_message = "vpc_id must start with 'vpc-'"
  }
}

variable "db_password" {
  type      = string
  sensitive = true
}
```

## Security

- Never hardcode credentials. Use environment variables, IAM roles, or vault.
- Remove SSH keys and credentials in a cleanup provisioner before creating the image.
- Use `source_ami_filter` with `owners` to prevent AMI poisoning.
- Pin base images to specific owners and filters, not AMI IDs (which are region-specific and go stale).

## Testing

- Validate templates before building: `packer validate .`
- Use `packer fmt` to enforce consistent formatting.
- For CI: `packer init .` (download plugins), then `packer validate .`, then `packer build .`.

## File Organization

```
packer/
  web.pkr.hcl           # Source + build for web server AMI
  variables.pkr.hcl     # Shared variables
  locals.pkr.hcl        # Computed locals
  scripts/
    setup.sh            # Provisioning scripts (referenced by provisioner)
    cleanup.sh
```

## Primary Sources

- [Packer HCL2 docs](https://developer.hashicorp.com/packer/docs/templates/hcl_templates)
- [Packer best practices](https://developer.hashicorp.com/packer/guides/packer-on-cicd)
