# Concurrency & Parallelism

> **Thread Safety** - Race conditions are hard to debug

## Step-by-Step Concurrency Safety

### Step 1: Identify Shared State
- Any variable accessed by multiple threads/requests
- Database rows updated concurrently
- Files written simultaneously

### Step 2: Use Proper Locking
```javascript
// ❌ Wrong - Race condition
const count = await getCount();
await setCount(count + 1);

// ✅ Correct - Atomic operation
await incrementCount(); // or use database atomic operations
```

### Step 3: Prevent Double Submit
```javascript
const [submitting, setSubmitting] = useState(false);

async function handleSubmit() {
  if (submitting) return;
  setSubmitting(true);
  try {
    await api.submit(data);
  } finally {
    setSubmitting(false);
  }
}
```

## Common Concurrency Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Race conditions | Inconsistent data | Use locks or atomic ops |
| Lost updates | Data overwritten | Optimistic locking |
| Check-then-act bugs | Stale check | Use atomic operations |
| Double submit | Duplicate actions | Disable on submit |
| Thread-unsafe code | Random failures | Use thread-safe structures |
| Non-atomic operations | Incorrect counts | Use database INCR |
| Deadlocks | System hangs | Consistent lock ordering |
| Starvation | Some threads blocked | Fair scheduling |
| Livelock | Constant retrying | Add backoff |

## Quick Concurrency Checklist

```
□ Shared state identified and protected
□ Atomic operations for counters
□ Optimistic locking for updates
□ Double-submit prevention
□ Deadlock prevention (lock ordering)
□ Connection pools properly sized
□ Thread-safe data structures used
```
