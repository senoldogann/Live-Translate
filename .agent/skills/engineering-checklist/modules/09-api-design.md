# API Design Standards

> **Contract-First** - APIs are contracts that cannot be broken once published

## Step-by-Step API Design

### Step 1: Use Correct HTTP Status Codes
| Code | When to Use |
|------|-------------|
| 200 | Success (GET, PATCH, DELETE) |
| 201 | Created (POST) |
| 400 | Bad request (client error) |
| 401 | Unauthorized (not authenticated) |
| 403 | Forbidden (authenticated but not authorized) |
| 404 | Not found |
| 429 | Rate limited |
| 500 | Server error |

### Step 2: Consistent Error Format
```json
{
  "error": {
    "code": "INVALID_EMAIL",
    "message": "Email format is invalid",
    "field": "email"
  }
}
```

### Step 3: Implement Versioning
- URL versioning: `/api/v1/users`
- Header versioning: `Accept: application/vnd.api.v1+json`
- Never break existing API without version bump

## Common API Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Wrong HTTP status codes | Confusion, broken clients | Use standards |
| Inconsistent error format | Hard to handle errors | Standardize format |
| Missing input validation | Security issues | Validate all inputs |
| Breaking changes without versioning | Client breakage | Version APIs |
| No rate limiting | Abuse, cost explosion | Implement limits |
| Wrong CORS configuration | Security or access issues | Configure properly |
| Unclear pagination contract | Inconsistent results | Document clearly |
| No webhook signature verification | Security risk | Always verify |
| No API key rotation strategy | Credential compromise | Plan rotation |
| File upload timeout issues | Failed uploads | Adjust timeouts |
| Binary/encoding problems | Corrupted data | Handle UTF-8, base64 |

## Quick API Checklist

```
□ RESTful naming conventions
□ Correct HTTP methods and status codes
□ Consistent error response format
□ Input validation on all endpoints
□ API versioning strategy
□ Rate limiting configured
□ Authentication on protected routes
□ Authorization checks present
□ CORS configured correctly
□ OpenAPI/Swagger documentation
□ Pagination for list endpoints
□ Request/response logging
```
