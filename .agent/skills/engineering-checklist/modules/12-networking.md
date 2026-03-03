# Networking

> **Reliability** - Networks are unreliable by nature

## Step-by-Step Network Reliability

### Step 1: Set Appropriate Timeouts
```javascript
fetch(url, {
  signal: AbortSignal.timeout(5000) // 5 second timeout
})
```

### Step 2: Implement Retry with Backoff
```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status < 500) throw new Error('Client error');
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

### Step 3: Configure Connection Pool
- Set max connections based on load
- Monitor pool utilization
- Set idle timeout to release unused connections

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| DNS/TTL issues | Connection failures | Monitor DNS |
| Wrong keep-alive | Connection overhead | Configure properly |
| Wrong pool size | Exhaustion or waste | Right-size pool |
| Missing timeouts | Hung requests | Always set timeouts |
| No retry backoff | Retry storms | Exponential backoff |
| Wrong compression | Errors or overhead | Test thoroughly |
