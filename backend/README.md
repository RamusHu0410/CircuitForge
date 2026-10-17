# CurcuitForge Backend

FastAPI backend for CurcuitForge.

## Requirements

- Python 3.11+

## Installation

Run all commands from the `backend/` directory.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional; defaults work without it
```

## Running the server

```bash
uvicorn app.main:app --reload
```

- Health check: http://127.0.0.1:8000/api/health
- Interactive API docs: http://127.0.0.1:8000/docs

## API

| Method | Path                               | Description                                  |
| ------ | ---------------------------------- | -------------------------------------------- |
| GET    | `/api/health`                      | Backend health check                         |
| GET    | `/api/components`                  | All registered component definitions         |
| GET    | `/api/components/{component_type}` | One component definition (404 if unknown)    |

Port data types: `number`, `boolean`, `vector2` (`{x, y}`), `event`, `game_state`.

## Project layout

- `app/schemas/` – Pydantic models (`blueprint.py`, `component.py`)
- `app/components/` – built-in components; each module exports `DEFINITION` (metadata) and `execute` (tick logic)
- `app/core/component_registry.py` – registry mapping component types to definitions and executors

## Running tests

```bash
pytest
```

## Configuration

Settings are read from environment variables or a `.env` file in `backend/`
(see `.env.example`).

| Variable       | Default                                   | Description                              |
| -------------- | ----------------------------------------- | ---------------------------------------- |
| `APP_NAME`     | `CurcuitForge API`                        | Name shown in docs and health response   |
| `APP_ENV`      | `development`                             | `development`, `test`, or `production`   |
| `DEBUG`        | `false`                                   | FastAPI debug mode                       |
| `API_PREFIX`   | `/api`                                    | Prefix for all API routes                |
| `CORS_ORIGINS` | `http://localhost:5173`, `:3000` variants | Comma-separated allowed browser origins  |

Never commit `.env` or API keys.
