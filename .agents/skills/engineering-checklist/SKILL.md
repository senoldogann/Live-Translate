# Engineering Checklist Skill

> **Version 1.0** | Anti-Patterns & Best Practices for Software Engineering

## Overview

This skill provides a **modular checklist** of common software engineering mistakes, anti-patterns, and best practices. Each category is a separate file for optimal LLM context usage.

## When to Use

- **Code Reviews**: Reference specific modules based on code type
- **Architecture Planning**: Consult architecture and design modules
- **Debugging**: Use incident response guide
- **Pre-Deployment**: Run through deployment checklists

## Module Index

Load ONLY the modules relevant to your current task:

| Module | File | Use When |
|--------|------|----------|
| Requirements & Product | [01-requirements.md](modules/01-requirements.md) | Defining features, acceptance criteria |
| Architecture & Design | [02-architecture.md](modules/02-architecture.md) | System design, service boundaries |
| Coding Logic | [03-coding-logic.md](modules/03-coding-logic.md) | General code review |
| Data Structures | [04-data-structures.md](modules/04-data-structures.md) | Algorithm/complexity issues |
| Database & ORM | [05-database.md](modules/05-database.md) | SQL, queries, migrations |
| Cache & Consistency | [06-cache.md](modules/06-cache.md) | Redis, caching strategies |
| Concurrency | [07-concurrency.md](modules/07-concurrency.md) | Race conditions, threading |
| Distributed Systems | [08-distributed.md](modules/08-distributed.md) | Microservices, queues |
| API Design | [09-api-design.md](modules/09-api-design.md) | REST, GraphQL, endpoints |
| Security | [10-security.md](modules/10-security.md) | OWASP, auth, encryption |
| Frontend & Mobile | [11-frontend.md](modules/11-frontend.md) | UI state, performance |
| Networking | [12-networking.md](modules/12-networking.md) | HTTP, timeouts, retries |
| Performance | [13-performance.md](modules/13-performance.md) | Optimization, profiling |
| Testing | [14-testing.md](modules/14-testing.md) | Unit, integration, E2E |
| DevOps & Release | [15-devops.md](modules/15-devops.md) | CI/CD, deployments |
| Logging & Monitoring | [16-observability.md](modules/16-observability.md) | Logs, metrics, traces |
| Privacy & Compliance | [17-privacy.md](modules/17-privacy.md) | GDPR, KVKK, PII |
| Payment & SaaS | [18-payment.md](modules/18-payment.md) | Subscriptions, billing |
| Search & Sorting | [19-search.md](modules/19-search.md) | Filtering, pagination |
| File & Media | [20-file-storage.md](modules/20-file-storage.md) | Uploads, S3, CDN |
| AI/ML Integration | [21-ai-integration.md](modules/21-ai-integration.md) | Prompt injection, safety |
| WebSocket & Real-time | [22-websocket.md](modules/22-websocket.md) | Connections, ordering |
| Third-Party APIs | [23-third-party.md](modules/23-third-party.md) | Webhooks, rate limits |
| Microservices | [24-microservices.md](modules/24-microservices.md) | Service mesh, discovery |
| Quick References | [quick-reference.md](modules/quick-reference.md) | Decision trees, checklists |
| Language Gotchas | [language-gotchas.md](modules/language-gotchas.md) | JS, Python, Go, Java |

## Usage Protocol

1. **Identify Category**: What type of code/system are you reviewing?
2. **Load Module**: Read ONLY the relevant module file
3. **Apply Checklist**: Use step-by-step guides and common mistakes
4. **Report Issues**: Use ❌/✅ format for clear feedback

## Integration with Other Skills

- **security-review**: For deep security audits
- **code-review-checklist**: For quick code review
- **systematic-debugging**: For debugging workflows
- **performance-profiling**: For optimization
