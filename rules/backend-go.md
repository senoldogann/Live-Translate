# GO ARCHITECTURE STANDARDS

## Core Philosophy
- **Standard Layout:** Follow `cmd/`, `internal/`, `pkg/` structure strictly.
- **Explicit over Implicit:** No magic frameworks. Use standard library or thin wrappers.

## Coding Rules
1.  **Context:** Every I/O function MUST accept `ctx context.Context` as the first arg.
2.  **Errors:** Use `fmt.Errorf("%w", err)` for wrapping. Never return raw error if context is needed.
3.  **Config:** Use `kelseyhightower/envconfig` or strict environment variable parsing. No hardcoded configs.
4.  **Concurrency:** Use `errgroup` for managing goroutines. Never use `go func()` without a wait mechanism.
5.  **Testing:** Table-driven tests are mandatory. Use `testcontainers` for integration tests.