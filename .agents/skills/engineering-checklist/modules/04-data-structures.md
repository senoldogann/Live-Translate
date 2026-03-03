# Data Structures & Algorithms

> **Efficiency** - Wrong choices cause performance disasters

## Step-by-Step Selection

### Step 1: Choose Right Data Structure
```javascript
// ❌ Wrong - O(n) lookup
const users = [];
const found = users.find(u => u.id === targetId);

// ✅ Correct - O(1) lookup
const users = new Map();
const found = users.get(targetId);
```

### Step 2: Analyze Complexity
- Nested loops = O(n²) - danger zone for large data
- Use appropriate algorithms (binary search vs linear)
- Profile actual performance with real data

### Step 3: Avoid Unnecessary Copies
```javascript
// ❌ Wrong - copying huge objects
const newState = {...hugeObject, field: newValue};

// ✅ Correct - update in place or use immutable library
```

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Wrong Big-O choice | Slow performance | Analyze complexity |
| Unnecessary object copying | Memory pressure | Use references |
| List instead of Map/Set | Slow lookups | Use right structure |
| Hash collision issues | Poor performance | Better key design |
| Precision/rounding errors | Wrong calculations | Use decimal libraries |
| Integer overflow | Wrong values | Check bounds |
| Weak random for security | Predictable values | Use crypto random |
