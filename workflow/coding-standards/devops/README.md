# DevOps / IaC Stack Detection

Agents: read this file to identify infrastructure tooling in the project, then load the matching file as a reference when generating `ai/instructions/devops.md`.

**Boundary with backend.md and conventions.md:** devops.md covers infrastructure-as-code conventions, image-build pipelines, and deployment tooling. Application-level patterns (service layers, ORM, error handling) belong in backend.md.

## Detection Signals

| Signal | Stack file |
|--------|-----------|
| `*.tf` files or `terraform/` directory | terraform.md |
| `*.pkr.hcl` files or `packer/` directory | packer.md |
| `*.json` with top-level `"builders"` key | packer.md (legacy JSON template) |
| Both tf and packer present | load both |

## Multiple IaC tools

Projects often combine Terraform (infrastructure) with Packer (base images) or Ansible (configuration management). Generate separate sections per tool or a unified devops.md with clear tool boundaries.
