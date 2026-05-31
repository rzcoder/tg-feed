# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" under the repository's **Security** tab), or by emailing the
maintainer.

Please include steps to reproduce and the affected version/commit. You can expect an
initial response within a few days.

## Scope notes

- tg-feed runs as a Telegram **userbot** on a dedicated account. Treat
  `TG_SESSION_STRING`, `TG_SESSION_ENCRYPTION_KEY`, `SESSION_SECRET`, `WEB_PASSWORD`, and
  `TG_BOT_TOKEN` as secrets — never commit them. `.env` is gitignored by default.
- The web UI is password- or Telegram-login gated and is intended to be deployed behind a
  TLS-terminating reverse proxy (Telegram Mini Apps require HTTPS).
