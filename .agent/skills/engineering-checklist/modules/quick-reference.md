# Quick Reference: Decision Trees & Checklists

> **Use These** for rapid decision-making during development

## Decision Tree 1: Should I Cache This?

```
START: Do I need to cache this data?
│
├─ Is this data READ frequently? ─NO→ DON'T CACHE
│   │
│   YES
│   │
├─ Does this data CHANGE frequently? ─YES→ Use SHORT TTL (seconds/minutes)
│   │
│   NO
│   │
├─ Is this data LARGE (>1MB)? ─YES→ Consider CDN or object storage
│   │
│   NO
│   │
├─ Is this data USER-SPECIFIC? 
│   │
│   ├─ YES → Use local/session cache
│   │
│   └─ NO → Use shared cache (Redis/Memcached)
│
└─ CACHE IT with appropriate TTL
```

## Decision Tree 2: Should I Use a Queue?

```
START: Should this be async (queue) or sync (request)?
│
├─ Does user need IMMEDIATE response? 
│   │
│   ├─ YES → Can I return "Accepted, processing..." ? 
│   │   │
│   │   ├─ YES → USE QUEUE + return 202 Accepted
│   │   │
│   │   └─ NO → SYNCHRONOUS (but add timeout)
│   │
│   └─ NO → Continue...
│
├─ Will this take >5 seconds? ─YES→ USE QUEUE
│
├─ Is this a background task? ─YES→ USE QUEUE
│
├─ Do I need to handle TRAFFIC SPIKES? ─YES→ USE QUEUE
│
├─ Can this FAIL and need retry? ─YES→ USE QUEUE
│
└─ SYNCHRONOUS is probably fine
```

## Decision Tree 3: Should I Retry This Error?

```
├─ Is this a NETWORK error? ─YES→ RETRY with backoff
│
├─ HTTP Status:
│   ├─ 5xx → RETRY with backoff
│   ├─ 429 → RETRY after Retry-After delay
│   ├─ 4xx → DON'T RETRY (fix request)
│
├─ Is operation IDEMPOTENT?
│   ├─ YES → Safe to retry
│   └─ NO → DON'T RETRY (add idempotency key)
```

## Pre-Deployment Checklist

### Code Review
```
□ All edge cases tested (null, empty, max values)
□ Error handling for all external calls
□ No hardcoded secrets or credentials
□ SQL queries use parameterized statements
□ Input validation on all user inputs
□ Proper logging with correlation IDs
□ No console.log() or debug statements
□ Database migrations are reversible
```

### Performance
```
□ No N+1 queries introduced
□ Database queries use indexes
□ Large operations use queues
□ Pagination implemented for lists
□ Images/assets optimized
```

### Security
```
□ Authentication on all protected endpoints
□ Authorization checks present
□ No SQL injection vulnerabilities
□ No XSS vulnerabilities
□ Rate limiting configured
□ Secrets in secret manager
□ HTTPS enforced
```

### Deployment
```
□ Feature flags configured
□ Database migrations tested
□ Rollback plan documented
□ Monitoring dashboard ready
□ On-call engineer notified
```
