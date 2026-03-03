# Testing Best Practices

> **Quality Assurance** - Untested code is broken code waiting to happen

## Step-by-Step Testing Strategy

### Step 1: Follow Test Pyramid
- Many unit tests (fast, isolated)
- Some integration tests (realistic)
- Few E2E tests (critical paths only)

### Step 2: Ensure Test Isolation
```javascript
beforeEach(() => {
  // Reset database state
  db.clearAll();
});

test('creates user', () => {
  // Test runs with clean state
});
```

### Step 3: Test Real Scenarios
```javascript
// ❌ Over-mocked test
const mockDb = { save: jest.fn() };

// ✅ Real integration test
const db = createTestDatabase();
await db.save(user);
const retrieved = await db.get(user.id);
expect(retrieved).toEqual(user);
```

## Common Testing Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Only unit tests | Integration breaks unnoticed | Add integration tests |
| Flaky tests | Random failures, ignored tests | Fix flakiness root cause |
| No test isolation | Tests affect each other | Reset state in beforeEach |
| Over-mocking | Tests pass, prod fails | Use real implementations |
| No E2E tests | Critical flows break | Add E2E for key flows |
| Coverage obsession | Missing important scenarios | Focus on scenario coverage |
| Unrealistic test data | Edge cases missed | Use production-like data |

## Quick Testing Checklist

```
□ Unit tests for business logic
□ Integration tests for API endpoints
□ E2E tests for critical user flows
□ Tests run in isolation
□ Test data is realistic
□ Edge cases covered (null, empty, max)
□ Error scenarios tested
□ Mocks used sparingly
□ CI runs tests on every PR
□ Coverage tracked (but not obsessed over)
```

## Test Structure: AAA Pattern

```javascript
test('should calculate total with discount', () => {
  // Arrange - Set up test data
  const items = [{ price: 100 }, { price: 50 }];
  const discount = 0.1;
  
  // Act - Execute the code under test
  const total = calculateTotal(items, discount);
  
  // Assert - Verify the result
  expect(total).toBe(135); // 150 - 10% = 135
});
```
