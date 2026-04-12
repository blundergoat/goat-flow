# Codex execpolicy rules for goat-flow
# https://developers.openai.com/codex/rules
# Decisions: allow, prompt, forbidden

def check(command):
    """Block dangerous commands before execution."""
    cmd = command.lower()

    # rm -rf / rm -fr without safe scoping
    if "rm " in cmd and ("-rf" in cmd or "-fr" in cmd):
        # Allow scoped: rm -rf ./tmp, rm -rf build/
        parts = cmd.split()
        for i, part in enumerate(parts):
            if part.startswith("-") and "r" in part and "f" in part:
                if i + 1 < len(parts):
                    target = parts[i + 1]
                    if target.startswith("./") or target[0].isalpha():
                        return "prompt"  # Ask before scoped deletion
                return "forbidden"  # Unscoped rm -rf

    # git push to main/master
    if "git push" in cmd and ("main" in cmd or "master" in cmd):
        return "forbidden"

    # Force push
    if "git push" in cmd and "--force" in cmd:
        return "forbidden"

    # git commit (require human action)
    if "git commit" in cmd:
        return "prompt"

    # git push (require human action)
    if "git push" in cmd:
        return "prompt"

    # git reset --hard
    if "git reset" in cmd and "--hard" in cmd:
        return "forbidden"

    # chmod 777
    if "chmod 777" in cmd:
        return "forbidden"

    # Pipe to shell
    if ("curl" in cmd or "wget" in cmd) and ("| bash" in cmd or "| sh" in cmd):
        return "forbidden"

    # .env modifications
    if ".env" in cmd and any(op in cmd for op in [">", ">>", "tee ", "sed -i"]):
        return "forbidden"

    # --no-verify bypass
    if "--no-verify" in cmd:
        return "forbidden"

    # sudo
    if cmd.startswith("sudo ") or " sudo " in cmd:
        return "prompt"

    # mkfs / dd (destructive)
    if "mkfs" in cmd or "dd if=" in cmd:
        return "forbidden"

    # Cloud destructive
    for cloud_cmd in ["docker push", "terraform destroy", "terraform apply", "aws s3 rm", "aws ec2 terminate"]:
        if cloud_cmd in cmd:
            return "forbidden"

    # Lockfile modifications (use package manager, not direct writes)
    for lockfile in ["package-lock.json", "yarn.lock", "composer.lock", "gemfile.lock", "pnpm-lock.yaml", "go.sum", "cargo.lock"]:
        if lockfile in cmd and any(op in cmd for op in [">", ">>", "tee ", "sed -i", "echo "]):
            return "prompt"

    # Destructive database commands
    for db_cmd in ["drop table", "drop database", "truncate table"]:
        if db_cmd in cmd:
            return "forbidden"

    # File truncation
    if "truncate " in cmd:
        return "forbidden"
    # > file (redirect that clobbers)
    parts = cmd.split()
    for i, part in enumerate(parts):
        if part == ">" and i + 1 < len(parts):
            return "forbidden"

    # git clean
    if "git clean" in cmd and ("-f" in cmd or "-fd" in cmd):
        return "forbidden"

    # eval / bash -c (arbitrary code execution)
    if cmd.startswith("eval ") or " eval " in cmd:
        return "prompt"
    if "bash -c" in cmd:
        return "prompt"

    # Force push shorthand (-f flag)
    if "git push" in cmd and " -f" in cmd:
        return "forbidden"
    if "git push" in cmd and "--force-with-lease" in cmd:
        return "forbidden"

    # Branch deletion
    if "git branch" in cmd and (" -D" in cmd or " -d" in cmd):
        return "prompt"

    # Secrets access (read or write sensitive credential files)
    for secret in [".pem", ".key", ".ssh/", ".aws/credentials", ".gnupg/"]:
        if secret in cmd:
            return "forbidden"

    return "allow"
