# Security Vulnerabilities Checklist

> **Critical Priority** - Security issues can expose user data and damage trust

## Step-by-Step Security Checklist

### Step 1: Prevent Injection Attacks
```javascript
// ❌ SQL Injection
const query = `SELECT * FROM users WHERE id = ${userId}`;

// ✅ Parameterized query
const query = 'SELECT * FROM users WHERE id = ?';
db.query(query, [userId]);
```

### Step 2: Validate & Sanitize Input
```javascript
// ❌ XSS vulnerability
element.innerHTML = userInput;

// ✅ Safe
element.textContent = userInput;
```

### Step 3: Implement Proper Authentication & Authorization
```javascript
// Always check BOTH authentication AND authorization
if (!user) return 401; // Not authenticated
if (!user.canAccessResource(resourceId)) return 403; // Not authorized
```

### Step 4: Secure Sensitive Data
- Never log passwords, tokens, or PII
- Use bcrypt/argon2 for password hashing
- Encrypt data at rest and in transit

## Critical Vulnerabilities Checklist

| Vulnerability | Risk | Prevention |
|--------------|------|------------|
| SQL/NoSQL injection | Data breach | Parameterized queries |
| Cross-Site Scripting (XSS) | Session hijack | Escape output, CSP |
| Cross-Site Request Forgery (CSRF) | Unauthorized actions | CSRF tokens |
| Server-Side Request Forgery (SSRF) | Internal access | URL validation |
| Path traversal | File access | Sanitize paths |
| Remote Code Execution (RCE) | Full compromise | Never eval user input |
| Insecure Direct Object Reference (IDOR) | Data access | Authorization checks |
| JWT vulnerabilities | Auth bypass | Strong algorithms, validation |
| Plaintext password storage | Account takeover | bcrypt/argon2 |
| Missing rate limiting | Brute force | Implement limits |
| 2FA/OTP implementation errors | Auth bypass | Use proven libraries |
| Logging secrets/tokens | Credential leak | Audit log content |
| Public S3 buckets | Data exposure | Private by default |
| Clickjacking | UI hijack | X-Frame-Options |
| Vulnerable dependencies | Various | Regular audits |
| Insecure deserialization | RCE | Validate before deserialize |
| Wrong TLS configuration | MITM | Modern TLS, strong ciphers |

## Quick Security Audit

```
□ All user inputs validated and sanitized
□ SQL uses parameterized queries
□ Auth tokens stored securely (HttpOnly cookies)
□ HTTPS enforced everywhere
□ Secrets in environment vars, not code
□ Dependencies scanned for vulnerabilities
□ Rate limiting on auth endpoints
□ CORS configured correctly
□ Security headers set (CSP, X-Frame-Options, etc.)
□ No sensitive data in logs
```
