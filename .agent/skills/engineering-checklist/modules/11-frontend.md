# Frontend & Mobile Best Practices

> **User Experience** - Frontend issues directly impact user satisfaction

## Step-by-Step Frontend Checklist

### Step 1: Prevent Double Submit
```jsx
function SubmitButton() {
  const [loading, setLoading] = useState(false);
  
  const handleClick = async () => {
    setLoading(true);
    try {
      await submitForm();
    } finally {
      setLoading(false);
    }
  };
  
  return <button disabled={loading} onClick={handleClick}>Submit</button>;
}
```

### Step 2: Handle Loading States
```jsx
// Show skeleton/spinner during load
{loading ? <Skeleton /> : <Content data={data} />}
```

### Step 3: Implement Offline Support
```javascript
window.addEventListener('online', () => {
  retryQueue.process();
});

window.addEventListener('offline', () => {
  showOfflineBanner();
});
```

## Common Frontend Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| State sync bugs | UI shows stale data | Single source of truth |
| Double-tap/multi-submit | Duplicate actions | Disable button on submit |
| Infinite re-render loops | Frozen UI, crashes | Check useEffect deps |
| Memory leaks | Performance degradation | Cleanup listeners/timers |
| List jank | Poor scrolling | Use virtualization |
| No skeleton/placeholder | Poor perceived performance | Add loading states |
| No offline handling | Broken experience | Implement offline support |
| No retry UX after errors | User frustration | Add retry buttons |
| Permission flow errors | Feature doesn't work | Handle permission denial |
| Deep link routing errors | Broken navigation | Test all deep links |
| Localization issues | Text overflow, RTL bugs | Test multiple locales |
| Missing accessibility | Unusable for some users | Add ARIA, keyboard nav |

## Quick Frontend Audit

```
□ Loading states for all async operations
□ Error states with retry options
□ Form validation with clear messages
□ Double-submit prevention
□ Memory cleanup in useEffect
□ List virtualization for long lists
□ Skeleton loaders implemented
□ Offline handling considered
□ Accessibility tested (keyboard, screen reader)
□ Responsive design verified
□ Touch targets large enough (44px minimum)
□ No layout shift on load (CLS)
```
