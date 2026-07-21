# Security Policy

## Current support status

Copilot App Phase 1 is still in development and has no generally available, signed and notarized release. Security fixes target the current macOS-first development line. Historical unsigned candidates, diagnostic packages and archived evidence are not supported releases.

Windows runtime and distribution support is owner-deferred to Phase 1.1. Static Windows compatibility work does not mean a supported Windows release exists.

## Reporting a vulnerability

Do not publish vulnerability details, proof-of-concept exploits, private data or credentials in a public issue, discussion, pull request, chat transcript or screenshot.

If this repository is hosted on GitHub in the future and private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** flow (GitHub Security Advisories). Until an official private reporting channel is published, contact the maintainer only through an already established private channel and share the minimum information needed to start triage.

This file does not publish a monitored email address and does not create a guaranteed response or remediation SLA. Reports will be triaged as maintainer capacity permits; severity, reproducibility, user impact and safe-fix availability determine priority.

Include, when safe:

- affected component and current revision/package identity;
- impact and required preconditions;
- minimal reproduction steps using non-sensitive test data;
- whether local notes, KB/KG data, tokens, credentials or remote control are exposed;
- suggested mitigation, if known.

Never send:

- passwords, OTP/2FA codes or recovery codes;
- API keys, bearer tokens, SecretId/SecretKey or signed URLs;
- Developer ID, notary, CAM or Keychain private material;
- production issuer private keys;
- real note, knowledge-base, calendar, voice or backup contents;
- credential-store or environment dumps.

If sensitive data was already exposed, rotate/revoke the affected credential through its owner-controlled provider before sharing a redacted report.

## Security boundaries

### Local-first data

- Notes, KB, KG, Todo, schedules and product truth remain local and authoritative.
- The renderer must not receive raw secrets or unrestricted filesystem access.
- Local mutation must not depend on cloud success.
- Logs, screenshots, reports and exported evidence must redact secrets and private user data.

### Tencent Cloud

Tencent Cloud is limited to an approved stateless LLM proxy, a bounded Remote relay and an explicit optional Backup boundary. It must not become the source of truth for notes, KB or KG.

- Backup is default OFF and opt-in only.
- Backup payloads must be encrypted on the client; plaintext and encryption keys must not reach COS or the proxy.
- Presigned URLs and backup credentials must be short-lived/least-privilege and must not be logged.
- Remote must use TLS/WSS and an external production issuer; missing or invalid authority must fail closed.
- Issuer private keys belong in an owner-controlled secret mount with restrictive ownership/mode, never in the repository or image.

### Model providers and credentials

Model/provider credentials belong in the operating-system credential store or an owner-controlled runtime secret boundary. They must not be persisted in notes, renderer state, ordinary settings JSON, fixtures, reports or source control.

## Scope priorities

High-priority reports include:

- local data disclosure, corruption or unauthorized deletion;
- renderer-to-main privilege escalation or unsafe IPC;
- credential/key extraction or logging;
- Backup plaintext exposure, unauthorized object access or destructive restore behavior;
- Remote authentication/signature bypass, replay, cross-session control or TLS downgrade;
- release-signing, update or evidence-integrity bypasses that could misrepresent an artifact as trusted.

Out-of-scope or lower-priority submissions may include vulnerabilities that require unsupported historical candidates, purely theoretical issues without a security boundary impact, or automated scanner output without a reproducible affected path. They may still be reviewed, but no response time is promised.

## Coordinated disclosure

Allow time for triage and a safe fix before public disclosure. Do not access data that is not yours, persist in a system, disrupt service, social-engineer users or test against production/cloud resources without explicit owner authorization.

Security reports and source fixes are not release evidence. A vulnerability fix is complete only at its authorized source/test scope; signed-package, notarization, real-device and final-candidate claims require their separate gates.
