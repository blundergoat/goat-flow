# Contributing to GOAT Flow

Thanks for your interest in contributing. This guide covers the basics.

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b my-change`)
3. Make your changes
4. Run the checks (see below)
5. Open a pull request against `main`

## Code Style

- **Markdown** for documentation (the bulk of the project)
- **Bash** for maintenance and validation scripts (`scripts/`)
- **TypeScript** for the scanner CLI (`src/cli/`)

Keep documentation concise. GOAT Flow targets ~120-line instruction files -- the same discipline applies to contributions.

## Testing

Before submitting a PR, run:

```bash
# Full preflight gate (scripts, structure, cross-references)
bash scripts/preflight-checks.sh

# Scanner tests (78 tests)
npm test

# Lint shell scripts
shellcheck scripts/maintenance/*.sh
```

## AI Assistance Disclosure

Contributions generated with AI coding assistants are welcome. Please disclose AI assistance in your PR description. All contributions are reviewed by humans before merging.

## Reporting Issues

Open a GitHub issue. Include:
- What you expected
- What happened instead
- Steps to reproduce (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
