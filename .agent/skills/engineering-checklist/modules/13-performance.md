# Performance Optimization

> **Measure First** - Never optimize based on assumptions

## Step-by-Step Performance Checklist

### Step 1: Profile Before Optimizing
- Use profiler to find actual bottlenecks
- Don't optimize based on assumptions
- Measure impact of each optimization

### Step 2: Optimize I/O
```javascript
// ❌ Synchronous I/O blocks thread
const data = fs.readFileSync('file.txt');

// ✅ Async I/O doesn't block
const data = await fs.promises.readFile('file.txt');
```

### Step 3: Reduce Payload Size
- Paginate large datasets
- Use compression
- Return only needed fields

### Step 4: Batch Operations
```javascript
// ❌ Individual queries
for (const id of ids) {
  await db.update(id, data);
}

// ✅ Batch operation
await db.batchUpdate(ids, data);
```

## Common Performance Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Premature optimization | Wasted effort | Profile first |
| No profiling | Guessing what's slow | Use proper tools |
| Synchronous I/O | Blocked threads | Use async I/O |
| Large JSON payloads | Slow transfers | Paginate, compress |
| Object bloat in memory | High memory usage | Pool objects |
| GC pressure | Performance spikes | Reduce allocations |
| Thundering herd | System overload | Stagger requests |
| Wrong batch size | Overhead or timeout | Test and tune |
| Blocking UI thread | Frozen interface | Use web workers |

## Quick Performance Audit

```
□ Profiling done to identify bottlenecks
□ Database queries optimized (indexes, no N+1)
□ API responses paginated
□ Images/assets optimized and lazy loaded
□ Caching implemented where appropriate
□ Async I/O used throughout
□ Batch operations for bulk updates
□ Bundle size optimized (code splitting)
□ CDN used for static assets
□ Compression enabled (gzip/brotli)
```

## Core Web Vitals Targets

| Metric | Good | Needs Work | Poor |
|--------|------|------------|------|
| LCP (Largest Contentful Paint) | ≤2.5s | ≤4s | >4s |
| FID (First Input Delay) | ≤100ms | ≤300ms | >300ms |
| CLS (Cumulative Layout Shift) | ≤0.1 | ≤0.25 | >0.25 |
