# Security Policy

## Supported Versions

Security fixes are applied on the `main` branch and included in the next tagged release.

## Reporting a Vulnerability

Please do not open a public issue for suspected security vulnerabilities.

Use GitHub Security Advisories for private reporting:

1. Open the repository on GitHub.
2. Go to `Security`.
3. Choose `Report a vulnerability`.
4. Include reproduction steps, impact, and any proof-of-concept details needed to validate the issue.

If private reporting is not available, contact the maintainer through a private channel before public disclosure.

## GitHub Security Features To Enable

The repository includes workflow-based scanning, but these GitHub settings should also be enabled in the repository UI:

1. Dependency graph
2. Dependabot alerts
3. Dependabot security updates
4. Secret scanning
5. Push protection for secret scanning
6. Code scanning default alerts view in the `Security` tab

## Automated Security Checks In This Repository

The following GitHub-native security automation is included:

1. CodeQL analysis in `.github/workflows/codeql.yml`
2. Dependency review on pull requests in `.github/workflows/dependency-review.yml`
3. Dependabot update configuration in `.github/dependabot.yml`
4. Trivy SARIF uploads for filesystem, container, secret, and misconfiguration scanning in `.github/workflows/security-scan.yml`

## Operational Notes

1. Review CodeQL and Trivy findings in the GitHub `Security` tab after each push or pull request.
2. Treat `.env` and deployment secrets as sensitive and never commit real credentials.
3. Prefer `wss://` for deployed sync endpoints and restrict allowed origins with `WS_ALLOWED_ORIGINS`.
