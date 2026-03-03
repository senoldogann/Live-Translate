# Coding Logic Errors

> **Fundamentals** - Small logic errors cause big problems

## Step-by-Step Coding Checklist

### Step 1: Boundary Checks
```javascript
// ❌ Wrong
for (int i = 0; i <= array.length; i++)

// ✅ Correct
for (int i = 0; i < array.length; i++)
```

### Step 2: Null Safety
```javascript
// ❌ Wrong
const name = user.profile.name;

// ✅ Correct
const name = user?.profile?.name ?? 'Anonymous';
```

### Step 3: Type Conversions
- Be explicit with conversions
- Consider locale for number/date parsing
- Watch for floating-point precision issues

### Step 4: State Management
- Single source of truth for each piece of state
- Unidirectional data flow
- Avoid scattered state mutations

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Off-by-one errors | Array out of bounds | Check boundaries |
| Null/undefined errors | Crashes | Optional chaining |
| Type conversion errors | Wrong values | Explicit conversions |
| Poor state management | Inconsistent UI | Single source of truth |
| Wrong assumptions | Hidden bugs | Validate assumptions |
| Magic numbers | Unclear code | Use constants |
| Wrong comparison (== vs ===) | Logic errors | Use strict equality |
| Unstable sorting | UI shifts | Add stable tie-breaker |
