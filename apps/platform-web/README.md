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
   npm install
   ```
3. Set up environment variables (see `.env.example`):
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## Mock API Architecture

The application currently uses a mock API layer located in `src/api/mock/data.ts` and `src/api/client.ts`. This allows us to build the UI independently of the backend. 

### Future Backend Integration

When the real AlterX OpenAPI specification is ready:
1. Generate the TypeScript API client from the OpenAPI spec.
2. Replace the mock implementation in `src/api/client.ts` with the generated HTTP client.
3. Update the `useQuery` calls if the data shape changes, though the UI components themselves should remain largely untouched if the domain models match.
4. Ensure `VITE_API_MODE=live` is configured in production.

## Environment Variables

- `VITE_API_MODE`: Set to `mock` for local development without a backend.
- `VITE_API_BASE_URL`: The URL of the real backend API (when implemented).

## Component QA

To verify all UI primitives and design tokens visually, navigate to:
`/dev/components`

This route is strictly for development purposes to ensure design consistency.
