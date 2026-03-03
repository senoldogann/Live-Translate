# Language-Specific Gotchas

> **Pitfalls** - Every language has its traps

## JavaScript/TypeScript

```javascript
// ❌ Common mistakes:
if (value == null) // Checks both null and undefined
[] == false // true (type coercion)
[1,2,3] + [4,5,6] // "1,2,34,5,6" (not [1,2,3,4,5,6])
0.1 + 0.2 === 0.3 // false (floating point)

// ✅ Best practices:
if (value === null || value === undefined)
Array.isArray(value)
[...arr1, ...arr2]

// Async gotchas:
// ❌ forEach doesn't wait
items.forEach(async item => {
  await process(item); // Doesn't wait!
});

// ✅ Use for...of
for (const item of items) {
  await process(item);
}
```

## Python

```python
# ❌ Mutable default argument
def bad(items=[]):
    items.append(1)
    return items

# ✅ Correct
def good(items=None):
    if items is None:
        items = []
    items.append(1)
    return items

# ❌ All rows are same object!
matrix = [[0] * 3] * 3

# ✅ Correct
matrix = [[0 for _ in range(3)] for _ in range(3)]
```

## Go

```go
// ❌ Closure captures loop variable
for i, v := range items {
    go func() {
        process(v) // v is shared!
    }()
}

// ✅ Correct
for i, v := range items {
    v := v // Create new variable
    go func() {
        process(v)
    }()
}

// Defer in loop accumulates!
for _, f := range files {
    file, _ := os.Open(f)
    defer file.Close() // Memory leak!
}
```

## Key Gotchas by Language

| Language | Gotcha | Fix |
|----------|--------|-----|
| JS | == vs === | Always use === |
| JS | async forEach | Use for...of |
| Python | Mutable defaults | Use None |
| Python | Matrix [[0]*3]*3 | Use comprehension |
| Go | Loop variable closure | Shadow variable |
| Go | Defer in loop | Wrap in function |
| Java | String == | Use .equals() |
| Java | Integer cache (127) | Use .equals() |
