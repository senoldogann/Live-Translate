# DevOps & Release

> **Safe Deployments** - Every release should be reversible

## Step-by-Step Deployment

### Step 1: Environment Parity
- Dev, staging, prod should be identical
- Use infrastructure as code
- Same configuration management

### Step 2: Secret Management
```bash
# ❌ Never commit secrets
DB_PASSWORD=secret123

# ✅ Use secret management
DB_PASSWORD=${SECRET_MANAGER.get('db_password')}
```

### Step 3: Database Migration Strategy
```
1. Deploy backward-compatible code first
2. Run migration
3. Deploy new code that uses new schema
4. Remove old compatibility code in next release
```

### Step 4: Implement Health Checks
```json
GET /health
{
  "status": "healthy",
  "database": "connected",
  "cache": "connected"
}
```

## Common DevOps Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Environment drift | "Works on my machine" | Infrastructure as Code |
| Secrets in code | Security breach | Use secret manager |
| Wrong config/flags | Wrong behavior | Config validation |
| No rollback plan | Stuck with bugs | Plan rollback before deploy |
| No blue-green deploy | Downtime | Use zero-downtime deploy |
| Migration conflicts | Broken app | Backward-compatible migrations |
| Missing rate limiting | Abuse | Implement limits |
| Disk space issues | Service crash | Monitor and alert |
| Wrong health checks | False failures | Test health endpoints |
| No observability | Blind to issues | Add logs, metrics, traces |

## Quick DevOps Checklist

```
□ Infrastructure as Code (Terraform, Pulumi)
□ Secrets in secret manager
□ Environment parity (dev = staging = prod)
□ Database migrations tested and reversible
□ Rollback plan documented
□ Health checks implemented
□ Monitoring and alerting configured
□ Logs centralized and searchable
□ Feature flags for risky changes
□ Zero-downtime deployment strategy
```
