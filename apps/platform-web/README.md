# AlterX Frontend

This is the frontend foundation for AlterX, an AI/agent workflow automation and execution platform.

## Architecture & Tech Stack

This project is built using:
- **React 18** with **TypeScript**
- **Vite** for fast bundling
- **Tailwind CSS v4** for styling and design tokens
- **React Router v6** for client-side routing
- **TanStack Query (React Query)** for server state and data fetching
- **React Hook Form** + **Zod** for form validation
- **Lucide React** for icons
- **Radix UI** primitives for accessible components (Dialogs, Dropdowns, etc.)

## Project Structure

```text
src/
├── api/             # API client, types, and mock adapter
├── app/             # Application providers and router setup
├── components/      # Reusable UI library (primitives and feedback states)
├── features/        # Domain-specific modules (Dashboard, Workflows, Auth)
├── layout/          # Application shells (AppShell, AuthLayout, Sidebar)
├── lib/             # Utilities and helpers (e.g., tailwind merge)
└── styles/          # Global styles and design tokens
```

## Running Locally

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up environment variables (see `.env.example`):
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   pnpm nx run platform-web:serve
   ```

## API Modes

The application uses the API client in `src/api/client.ts`. It supports a mock mode for local UI work and a live mode that calls the platform API, including workflow, run, connection, and credential-vault operations.

Set `VITE_API_MODE=live` and `VITE_API_BASE_URL` to use the running platform API. Set `VITE_API_MODE=mock` for local development without backend services.

## Environment Variables

- `VITE_API_MODE`: `mock` for local development without a backend, or `live` for the platform API.
- `VITE_API_BASE_URL`: Base URL of the live platform API.

## Component QA

To verify all UI primitives and design tokens visually, navigate to:
`/dev/components`

This route is strictly for development purposes to ensure design consistency.
