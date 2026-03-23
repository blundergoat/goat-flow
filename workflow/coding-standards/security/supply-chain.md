# Supply Chain Security

Reference for generating `ai/instructions/security.md` in projects with third-party dependencies.

## Lockfile Integrity

- Commit lockfiles to version control. They pin exact versions of every transitive dependency.
- In CI, always install from the lockfile — never resolve fresh.

```bash
# DO — install from lockfile in CI
npm ci                          # Node
pip install --require-hashes -r requirements.txt  # Python
composer install --no-dev       # PHP
bundle install --frozen         # Ruby
cargo build --locked            # Rust
dotnet restore --locked-mode    # .NET

# DON'T — resolve fresh in CI
npm install    # may resolve different versions than local
pip install -r requirements.txt  # no hash verification
```

## Version Pinning

- **Lockfiles**: always exact versions (handled automatically by package manager).
- **Manifests** (package.json, pyproject.toml): ranges are acceptable, but prefer tight ranges.
- Review version bumps in PRs — `npm diff` or `cargo update --dry-run` to see what changed.

```json
// DO — tight range
"dependencies": {
  "express": "^4.18.0"
}

// DON'T — accept any version
"dependencies": {
  "express": "*"
}
```

## Audit Commands

Run audits in CI on every PR. Block merge on critical/high severity.

| Ecosystem | Audit command | Fix command |
|-----------|--------------|-------------|
| Node (npm) | `npm audit --audit-level=high` | `npm audit fix` |
| Node (yarn) | `yarn audit --level high` | `yarn upgrade` |
| Python | `pip-audit` | Update manually: `pip install --upgrade <package>` |
| Ruby | `bundle audit check --update` | Update Gemfile.lock |
| Rust | `cargo audit` | `cargo update` |
| PHP | `composer audit` | `composer update` |
| Go | `govulncheck ./...` | `go get -u` |
| .NET | `dotnet list package --vulnerable` | Update .csproj |
| Java | OWASP dependency-check plugin | Update pom.xml/build.gradle |

## CI Pipeline Security

```yaml
# DO — pin GitHub Actions to full SHA
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1

# DON'T — pin to mutable tag
- uses: actions/checkout@v4    # tag can be moved to point at different code
- uses: actions/checkout@main  # branch ref, even worse
```

- Review Dependabot/Renovate PRs before merging. Read the changelog. Check for breaking changes.
- Limit Dependabot to security updates if update volume is unmanageable.

## Transitive Dependency Inspection

Know what you are shipping. The direct dependency is audited; its 47 transitive deps may not be.

```bash
# Inspect dependency trees
npm ls --all                    # Node
pip show <package>              # Python (direct deps only)
pipdeptree                      # Python (full tree)
bundle viz                      # Ruby
cargo tree                      # Rust
composer show --tree            # PHP
dotnet list package --include-transitive  # .NET
```

## Common Footguns

- **Typosquatting**: `colors` vs `colour`, `lodash` vs `1odash`. Verify package name and publisher before installing.
- **Install scripts**: npm `postinstall` scripts run arbitrary code on `npm install`. Use `--ignore-scripts` in CI and whitelist exceptions.
- **Unpinned CI actions**: a compromised action tag silently runs malicious code in your pipeline. Pin to full SHA.
- **Star/download metrics**: popularity does not equal safety. Check the source, not the star count.
- **Abandoned packages**: no updates in 2+ years with open security issues. Fork or replace.
- **Private registry confusion**: if you use a private registry, configure `.npmrc` / `pip.conf` to scope your org packages to your registry to prevent dependency confusion attacks.
