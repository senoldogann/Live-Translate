# Database & ORM Best Practices

> **High Impact** - Database issues cause the most production incidents

## Step-by-Step Database Checklist

### Step 1: Prevent N+1 Queries
```sql
-- ❌ Wrong - N+1 query
SELECT * FROM posts;
-- Then for each post:
SELECT * FROM comments WHERE post_id = ?;

-- ✅ Correct - Single query with join
SELECT posts.*, comments.* 
FROM posts 
LEFT JOIN comments ON posts.id = comments.post_id;
```

### Step 2: Add Indexes Strategically
- Index columns used in WHERE, JOIN, ORDER BY
- Use EXPLAIN to check query plans
- Create composite indexes for multi-column queries

### Step 3: Use Transactions Properly
- Wrap related operations in transactions
- Choose correct isolation level
- Keep transactions short to avoid locks

### Step 4: Handle Timezone Correctly
- Store dates in UTC
- Convert to user's timezone only for display
- Use TIMESTAMP WITH TIME ZONE

## Common Database Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| N+1 query problem | Slow performance | Use JOINs or eager loading |
| Missing indexes | Slow queries | Add indexes on queried columns |
| SELECT * | Fetching unnecessary data | Select only needed columns |
| Wrong JOIN | Cartesian products | Verify JOIN conditions |
| No transactions | Partial writes | Wrap in transactions |
| Wrong isolation level | Dirty/phantom reads | Choose appropriate level |
| Deadlocks | Blocked requests | Consistent lock ordering |
| Missing foreign keys | Orphan records | Add FK constraints |
| Missing unique constraints | Duplicates | Add unique indexes |
| Forgetting soft-delete filter | Showing deleted data | Always filter is_deleted |
| Timezone errors | Wrong times displayed | Store in UTC |
| Slow pagination with OFFSET | Poor performance on large tables | Use keyset pagination |
| Connection pool leaks | Connection exhaustion | Properly close connections |
| Long transactions | Lock contention | Keep transactions short |
| No batch operations | Slow bulk inserts | Use batch INSERT |

## Quick Database Audit

```
□ No N+1 queries (check ORM eager loading)
□ Indexes on frequently queried columns
□ EXPLAIN shows index usage
□ Transactions wrap related operations
□ All dates stored in UTC
□ Connection pool properly configured
□ Migrations tested and reversible
□ Foreign key constraints in place
□ Unique constraints where needed
□ Soft-delete filter applied globally
```
