# MICROSERVICES & SYSTEM DESIGN

## 1. Communication Protocol
- **Sync:** Use gRPC (Protobuf) for internal service-to-service calls (High Performance).
- **Async:** Use RabbitMQ/Kafka for event propagation (Decoupling).
- **Contract:** Schema-first design. Do not code before defining the `.proto` or OpenAPI spec.

## 2. Resilience Patterns
- **Retries:** Implement exponential backoff for network calls.
- **Circuit Breaker:** Fail fast if a dependent service is down.
- **Idempotency:** All POST/PUT requests must handle duplicate executions safely (use `Idempotency-Key` header).

## 3. Observability
- **Logs:** JSON format only. Must include `trace_id` and `span_id`.
- **Metrics:** Expose Prometheus metrics (`/metrics`) for RED method (Rate, Errors, Duration).
- **Tracing:** OpenTelemetry implementation is mandatory.

## 4. Deployment
- **Health Checks:** `/health/live` (I am running) vs `/health/ready` (I can accept traffic).
- **Config:** 12-Factor App principles. Configuration via Environment Variables only.