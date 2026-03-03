# Cache & Data Consistency

> **Speed vs Freshness** - Balance carefully

## Step-by-Step Caching Strategy

### Step 1: Choose Cache Pattern
```javascript
// Cache-Aside Pattern
async function getUser(id) {
  let user = await cache.get(`user:${id}`);
  
  if (!user) {
    user = await db.getUser(id);
    await cache.set(`user:${id}`, user, TTL);
  }
  
  return user;
}
```

### Step 2: Invalidate Properly
```javascript
async function updateUser(id, data) {
  await db.updateUser(id, data);
  await cache.delete(`user:${id}`);
}
```

### Step 3: Set Appropriate TTL
- Frequently changing data: short TTL (minutes)
- Rarely changing data: long TTL (hours/days)
- Always have expiration to prevent permanent stale data

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Stale cache | Wrong data shown | Proper invalidation |
| Cache stampede | DB overload | Locking or stagger |
| Hot key problem | Single point bottleneck | Shard hot keys |
| Cache penetration | DB stress | Cache null values |
| Wrong TTL | Stale or useless | Tune per data type |
| Local + global cache mix | Inconsistency | Clear strategy |
