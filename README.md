# Claude OCA Workbench

Local TypeScript workspace for running an Oracle Code Assist compatibility workbench around a Claude Code-style runtime.

## Workspace

- `runtime/` - core workbench engine, tool catalog, session state, and OCA model provider.
- `backend/` - Express API, SSE session streaming, file attachments, health checks, and optional JD MCP bridge.
- `frontend/` - Vite + React workbench UI.
- `src/` - reference Claude Code source tree used for compatibility work; it is not part of the npm workspace build.

## Requirements

- Node.js 20+
- npm
- Access to an OCA-compatible chat completions endpoint

## Setup

Install dependencies:

```bash
npm install
```

Create a local `.env` file in the repo root:

```bash
OCA_BASE_URL=https://your-oca-endpoint.example.com
OCA_TOKEN=your-token
OCA_MODEL=oca/gpt-5.4
```

Optional backend settings:

```bash
PORT=4317
SUPPORT_WORKBENCH_SESSION_MODE=isolated
JD_MCP_ROOT=../jd-mcp
JD_MCP_JDTOOLS_JAVA=C:/path/to/java.exe
JD_MCP_JDTOOLS_DIR=C:/path/to/jdtools
JD_MCP_FORMS_HOME=C:/path/to/forms
```

### Session Privacy

Support Workbench defaults to `SUPPORT_WORKBENCH_SESSION_MODE=isolated`. In this mode the backend assigns each browser an HttpOnly client cookie and persists that owner on new session records. Session list, resume/read, prompt, approval, stream, attachment, report, and delete APIs only resolve sessions owned by that browser. A new browser profile, machine, or incognito window starts with an empty session list by default.

For single-user local troubleshooting where a deliberately shared global workspace is acceptable, set:

```bash
SUPPORT_WORKBENCH_SESSION_MODE=shared
```

Shared mode disables browser owner filtering and exposes all sessions in the workspace to every browser that can reach the backend. Do not use shared mode on a VM/IP deployment that multiple users can access.

## Development

Run the backend API on `http://localhost:4317`:

```bash
npm run dev:backend
```

Run the frontend on `http://localhost:4173`:

```bash
npm run dev:frontend
```

The frontend dev server proxies `/api` requests to the backend.

## Checks

Run all workspace tests:

```bash
npm test
```

Build all workspaces:

```bash
npm run build
```

You can also target an individual workspace:

```bash
npm run test -w runtime
npm run test -w backend
npm run test -w frontend
```

## Useful Endpoints

- `GET /api/health/oca` - OCA provider health
- `GET /api/health/jd-mcp` - JD MCP bridge health
- `POST /api/session` - create or resume a workbench session
- `GET /api/sessions` - list sessions for a workspace
- `POST /api/session/:sessionId/prompt` - submit a prompt
- `GET /api/session/:sessionId/stream` - stream session events with SSE
