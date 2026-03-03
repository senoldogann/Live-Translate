# Logging & Observability

> **Visibility** - If you can't see it, you can't fix it

## Step-by-Step Observability

### Step 1: Structure Logs
```json
{
  "timestamp": "2026-01-28T10:30:00Z",
  "level": "ERROR",
  "service": "payment-service",
  "correlationId": "abc-123",
  "message": "Payment failed",
  "error": "Insufficient funds",
  "userId": "user-456"
}
```

### Step 2: Use Correlation IDs
- Generate unique ID for each request
- Pass through all services
- Include in all logs

### Step 3: Monitor Key Metrics
- Latency (p50, p95, p99)
- Error rate
- Throughput (requests per second)
- Saturation (CPU, memory, disk)

### Step 4: Classify Errors
```javascript
if (isRetryable(error)) {
  scheduleRetry();
} else {
  alertOperations();
}
```

## Common Observability Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Swallowing exceptions | Hidden bugs | Always log errors |
| Wrong log levels | Signal/noise issues | Use levels appropriately |
| Logging PII/secrets | Compliance violation | Audit log content |
| No correlation IDs | Cannot trace requests | Add to all logs |
| No metrics | Blind to trends | Add key metrics |
| No distributed tracing | Cannot debug latency | Add tracing |
| Not classifying errors | Wrong responses | Separate retriable/fatal |

## Quick Observability Checklist

```
□ Structured JSON logging
□ Correlation IDs on all requests
□ Log levels used appropriately
□ No PII/secrets in logs
□ Key metrics collected (latency, errors, throughput)
□ Dashboards for critical services
□ Alerts for key thresholds
□ Distributed tracing enabled
□ Log retention policy defined
□ Error tracking service configured
```
