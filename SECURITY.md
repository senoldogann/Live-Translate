# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | ✅ Active support  |

## Reporting a Vulnerability

If you discover a security vulnerability in Stealth Subtitle Translator, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub Issue** for security vulnerabilities.
2. Send an email to **contact@senoldogan.dev** (or open a [private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on GitHub).
3. Include:
   - A clear description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

### What to Expect

- **Acknowledgement** within **48 hours** of your report.
- A fix or mitigation plan within **7 days** for critical issues.
- Credit in the release notes (unless you prefer anonymity).

## Security Design

### Electron Hardening
- **Context Isolation**: Enabled — renderer has no direct Node.js access.
- **Node Integration**: Disabled — all IPC goes through the preload bridge.
- **Sandbox**: Enabled for the overlay, history, API settings, and usage guide windows.
- **Content Security Policy**: Applied to all secondary windows.
- **`webSecurity`**: Enabled in production builds.
- **`shell.openExternal`**: URL whitelist enforced — only known domains allowed.

### Data Handling
- **API Keys**: Stored in `userData` only as Electron `safeStorage` ciphertext (base64) inside a `0600` config file and never sent back to the renderer. A legacy plaintext field is migrated on the next credential write.
- **No Telemetry**: The app does not phone home or collect any data.
- **Screen Protection**: `setContentProtection(true)` prevents screen capture of the overlay.
- **IPC Validation**: Config payloads are schema-validated before writing to disk.

### Python Engine
- Runs as a local child process — no network listeners except `localhost` ZMQ.
- On macOS the ZMQ pair uses per-process Unix-domain sockets under a `0700` session directory; TCP remains only as the non-macOS compatibility path.
- Transcript and command traffic is signed with HMAC-SHA256, timestamped, versioned and replay-checked by both processes.

## Known Limitations

- Legacy plaintext API keys remain until the next configuration save migrates them to encrypted values.
- The `setContentProtection` API is macOS-only. On other platforms, the overlay may be visible in screen captures.

## Dependencies

We regularly audit dependencies:
- **Node.js**: `npm audit`
- **Python**: `pip audit` (via `pip-audit` package)

If you find a vulnerable dependency, please report it as described above.
