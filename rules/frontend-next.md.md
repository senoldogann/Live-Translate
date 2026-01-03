# NEXT.JS & UI STANDARDS

## Core Philosophy
- **Server-First:** Render everything on the server. Use `'use client'` only for interactivity (listeners, hooks).
- **Zero-Trust Client:** Never trust data coming from the client in Server Actions. Use Zod.

## Coding Rules
1.  **Performance:** Use `next/image` and `next/font`. Avoid large layout shifts (CLS).
2.  **State:** URL Search Params > Server Component Fetching > React Query > Zustand > Context API.
3.  **Components:** Split into `features/` (logic-heavy) and `ui/` (dumb/reusable).
4.  **Tailwind:** Use `clsx` or `cn` helper. Do not use dynamic string concatenation for classes.