# SECURITY & DEFENSE STANDARDS

## Core Philosophy
- **Secure by Default:** Assume the network is hostile.

## Coding Rules
1.  **Input:** Sanitize ALL inputs. Use `zod`, `validator`, or strict structs.
2.  **Secrets:** NEVER commit `.env`. Add `.env` to `.gitignore` immediately.
3.  **Auth:** Use standard libraries (JWT with RS256, OAuth2). Do not roll your own crypto.
4.  **Rate Limiting:** Every public API endpoint must have rate limiting (Redis-backed).
5.  **Dependency:** Suggest `govulncheck` or `npm audit` before finishing the task.