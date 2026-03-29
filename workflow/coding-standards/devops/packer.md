# Packer Coding Standards

Reference for generating `ai/instructions/devops.md` in projects using Packer.

## Template Format

Use HCL2 (`.pkr.hcl`). The legacy JSON format is deprecated.

```hcl
# DO — HCL2 template with variables block
packer {
  required_version = "~> 1.10"   # >= 1.10.0, < 1.11.0 — patch updates only
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1.3.0"   # three-segment: patch updates only, blocks 1.4.x
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "base_ami" {
  type        = string
  description = "Source AMI ID — must be pinned, not a filter returning latest"
}
```

- Pin the `packer` CLI version and every plugin. Unpinned builds silently produce different images over time.
- Declare all runtime values as `variable` blocks. Secrets are passed via `PKR_VAR_*` env vars at build time.

## Source Image Pinning

```hcl
# DO — pin to a specific AMI ID
source "amazon-ebs" "base" {
  region        = var.aws_region
  source_ami    = var.base_ami   # pinned AMI ID, passed at build time after vetting
  instance_type = "t3.micro"
  ssh_username  = "ubuntu"
  ami_name      = "myapp-base-{{timestamp}}"
}

# DON'T — resolve "latest" at build time
source "amazon-ebs" "base" {
  source_ami_filter {
    filters = { name = "ubuntu/images/*22.04*", virtualization-type = "hvm" }
    owners  = ["099720109477"]
    most_recent = true   # different AMI on every build — unpredictable base
  }
}
```

- Pin source AMIs to specific IDs that have been vetted and scanned. Track them in a variable file or parameter store.
- If you must use a filter, resolve it in a separate pipeline step, scan the resolved ID, and pass it explicitly to the Packer build.

## Secrets in Provisioners

Secrets must never be baked into an AMI image.

```hcl
# DO — wrap provisioners in a build block (required in HCL2)
build {
  sources = ["source.amazon-ebs.base"]

  # Pass secrets as env vars; never inline them in the command string
  provisioner "shell" {
    environment_vars = ["DB_PASS=${var.db_pass}"]
    inline = [
      "configure-app --db-pass \"$DB_PASS\"",
    ]
  }
}

# DON'T — hardcode credentials in provisioner commands
build {
  sources = ["source.amazon-ebs.base"]
  provisioner "shell" {
    inline = ["aws configure set aws_secret_access_key AKIAIOSFODNN7EXAMPLE"]
  }
}
```

- After the build completes, rotate any credentials used during provisioning.
- Remove SSH authorized keys added during build: `rm -f /home/ubuntu/.ssh/authorized_keys`.
- Run `strings` or a secret-scanning tool against the finished image artifact before distributing.

## Build Hygiene

Every image build should leave no provisioning artifacts.

```hcl
# DO — clean up as the last provisioner in the build block
build {
  sources = ["source.amazon-ebs.base"]

  # ... other provisioners first ...

  provisioner "shell" {
    inline = [
      # Remove package manager caches
      "apt-get clean && rm -rf /var/lib/apt/lists/*",
      # Remove bash history for root and all home directories
      "truncate -s 0 /root/.bash_history",
      "find /home -name '.bash_history' -exec truncate -s 0 {} \\;",
      # Remove cloud-init logs and instance data (may contain user data secrets)
      # --logs flag requires cloud-init >= 21.4; use 'cloud-init clean' on older systems
      "cloud-init clean --logs",
      # Remove any temp files written during provisioning
      "rm -f /tmp/setup.sh /tmp/secrets.env",
    ]
    execute_command = "sudo sh -c '{{ .Vars }} {{ .Path }}'"
  }
}
```

- Run cleanup as the **last** provisioner so it can remove everything written by earlier steps.
- Use `only` and `except` on provisioners to keep environment-specific steps isolated.

## Validation and Testing

```bash
# DO — validate and format-check before every build
packer fmt -check .
packer validate -var-file=vars.pkrvars.hcl .

# Run in CI: fail on fmt or validate errors before spending instance time
packer fmt -check . && packer validate .
```

```hcl
# DO — scan the live filesystem during the build, before the snapshot is taken
# (trivy image scans container images; for AMI/VM builds use trivy rootfs)
build {
  sources = ["source.amazon-ebs.base"]

  provisioner "shell" {
    inline = [
      "curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin",
      "trivy rootfs --severity HIGH,CRITICAL --exit-code 1 /",
      "rm /usr/local/bin/trivy",   # don't bake the scanner into the image
    ]
  }

  # Tag the resulting AMI with provenance metadata
  # (tags are set on the source block, shown here for illustration)
}
```

- `packer validate` catches HCL syntax and variable errors before spending time on a full build.
- For AMI/VM images, scan with `trivy rootfs /` inside a provisioner *before* the snapshot — not as a post-processor on the local machine. `trivy image` is for container images only.
- Tag built images with metadata: `build_date`, `source_ami`, `git_commit`, `pipeline_run_id`.

```hcl
# DO — tag images with provenance metadata
source "amazon-ebs" "base" {
  ...
  tags = {
    Name        = "myapp-base-{{timestamp}}"
    BuiltBy     = "packer"
    SourceAMI   = var.base_ami
    GitCommit   = "{{env `GIT_COMMIT`}}"
    Environment = var.environment
  }
}
```

## Common Footguns

- **`most_recent = true` in source filter**: the base image changes on every build. A patched upstream AMI can introduce unexpected behavior. Pin explicitly.
- **Secrets left in image**: credentials written during provisioning persist in `/root/.bash_history`, temp files, or package manager logs if not cleaned up.
- **No `packer validate` in CI**: HCL errors are caught only when the build runs, wasting build minutes and instance costs.
- **SSH key not removed before AMI creation**: authorized keys added for provisioner access remain in the image and grant access to every instance launched from it.
- **No image scanning**: the base OS or installed packages may have CVEs. Scan with `trivy rootfs /` in a provisioner before the AMI snapshot, not after. `trivy image` scans container images — it cannot scan an AMI ID.
- **Unpinned plugin versions**: `version = ">= 1.0"` resolves to the latest compatible plugin at build time. A plugin upgrade can silently change build behavior. Use `~> X.Y.Z` (three-segment) to allow only patch updates.
- **Broad IAM permissions for the build role**: Packer only needs `ec2:RunInstances`, `ec2:CreateImage`, `ec2:TerminateInstances`, and related describe/tag actions. Granting `ec2:*` or broader is unnecessary.
