# Distributed Systems

> **Failure is Normal** - Design for partial failures

## Step-by-Step Distributed Design

### Step 1: Implement Retries with Backoff
```javascript
async function callServiceWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 10000);
      await sleep(delay);
    }
  }
}
```

### Step 2: Add Circuit Breaker
- Open circuit after N failures
- Half-open after timeout to test recovery
- Close circuit when service recovers

### Step 3: Make Operations Idempotent
```javascript
POST /payments
{
  "amount": 100,
  "idempotency_key": "uuid-12345"
}
```

## Common Distributed Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| No network partition handling | System fails | Design for partitions |
| Retry storms | System overload | Exponential backoff + jitter |
| Missing timeouts | Requests hang forever | Always set timeouts |
| No circuit breaker | Cascading failures | Add circuit breaker |
| Non-idempotent operations | Duplicates on retry | Use idempotency keys |
| Out-of-order events | Incorrect state | Use sequence numbers |
| Clock skew | Ordering issues | Use logical clocks |
| No SAGA for transactions | Inconsistent state | Implement compensation |

## Quick Distributed Checklist

```
□ Timeouts on all external calls
□ Retries with exponential backoff
□ Circuit breaker for failing services
□ Idempotency keys for mutations
□ Message ordering handled
□ Health checks implemented
□ Graceful degradation planned
□ Correlation IDs passed through
```
