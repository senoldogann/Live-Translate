# Contributing

Thanks for taking the time to contribute.

## Code of Conduct

Be respectful and professional in all interactions. Discrimination, harassment, or toxic
behavior is not tolerated.

## Development Workflow

1. **Fork & clone** the repository.
2. **Create a branch** for each change: `feature/...`, `fix/...`, or `chore/...`.
3. **Install dependencies:**

   ```bash
   npm install
   npm run python:install   # sets up the Python environment
   ```

4. **Environment:** For cloud testing, enter your Azure Speech key + region (and optionally
   Deepgram / DeepL) in the in-app *API Settings* window. Deepgram and DeepL are optional —
   they act as fallback / quality layers.

5. **Coding conventions:**
   - TypeScript: strict mode is active — avoid `any`.
   - React: functional components and hooks.
   - Python: keep `ruff` happy (`ruff check` and `ruff format --check` in `python/`).
   - Style: follow the existing glassmorphism design language.

## Pull Request Checklist

Before opening a PR:

- [ ] `npm test -- --run` passes (add tests for new features).
- [ ] `npm run build` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `ruff check` and `ruff format --check` pass for Python changes.
- [ ] Update `README.md` or `ARCHITECTURE.md` if the change affects them.
- [ ] Use clear, conventional commit messages (e.g. `feat: add streaming mode toggler`).

## Bug Reporting

Open an issue in the Issues section and include:

1. What happened.
2. What you expected to happen.
3. Steps to reproduce.
4. Logs or screenshots (the app can export logs via the UI).
