# Requirements & Product

> **Foundation** - Bad requirements lead to bad software

## Step-by-Step Prevention

### Step 1: Define Measurable Requirements
- ❌ **Vague**: "The system should be fast"
- ✅ **Measurable**: "API response time < 200ms for 95th percentile"

### Step 2: Control Scope
- Set clear boundaries at project start
- Use a change control process for new requests
- Track scope changes and their impact on timeline

### Step 3: Prioritize Correctly
- Focus on critical user flows first
- Use MoSCoW method (Must, Should, Could, Won't)
- Don't build "nice-to-have" features before "must-have"

### Step 4: Handle Edge Cases
- Test with: empty lists, single items, maximum limits, null values
- Create edge case checklist during design phase

### Step 5: Define "Done"
- Write acceptance criteria before coding
- Include test coverage requirements
- Specify performance benchmarks

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Unmeasurable requirements | Unclear success | Define metrics |
| Uncontrolled scope creep | Missed deadlines | Change control process |
| Wrong prioritization | Wrong features built | MoSCoW method |
| Edge-case blindness | Production bugs | Edge case checklist |
| No "Done" definition | Never finished | Acceptance criteria |
