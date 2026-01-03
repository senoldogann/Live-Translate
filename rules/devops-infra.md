# DEVOPS & KUBERNETES STANDARDS

## Core Philosophy
- **Immutable Infrastructure:** Once built, a container never changes. Configs are injected via Env Vars.

## Coding Rules
1.  **Docker:** Multi-stage builds are mandatory to minimize image size (distroless/alpine).
2.  **Security:** Container must run as `USER nonroot`.
3.  **K8s Probes:** - `livenessProbe`: Restart if dead /health/live
    - `readinessProbe`: Stop traffic if overloaded /health/ready
4.  **Logs:** All logs must be sent to `stdout`/`stderr` in JSON format.