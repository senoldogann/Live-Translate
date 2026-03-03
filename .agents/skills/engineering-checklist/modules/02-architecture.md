# Architecture & Design

> **Foundations** - Bad architecture is expensive to fix later

## Step-by-Step Design Process

### Step 1: Define Service Boundaries
- Identify bounded contexts (domain-driven design)
- Each service owns its data
- Minimize cross-service transactions

### Step 2: Balance Abstraction
- ❌ **Over-engineering**: Building complex infrastructure before you need it
- ❌ **Under-engineering**: Copy-pasting code everywhere
- ✅ **Right level**: Abstract when you see patterns repeated 3+ times

### Step 3: Eliminate Single Points of Failure
- Multiple instances of critical services
- Database replication/failover
- Load balancers with health checks

### Step 4: Plan for Versioning
- API versioning strategy from day one
- Database schema migration plan
- Backward compatibility requirements

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| God services/monolith | Hard to scale/maintain | Split by domain |
| Unclear service boundaries | Tight coupling | Bounded contexts |
| Over-engineering | Wasted effort | YAGNI principle |
| Under-engineering | Code duplication | DRY when 3+ repeats |
| Single points of failure | Outages | Redundancy |
| No backward compatibility | Breaking changes | Version APIs |
| Wrong queue vs sync choice | Performance issues | Analyze latency needs |
