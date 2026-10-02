# Build context: services/modeling
#   docker build -t soundcheck-modeling services/modeling
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.5 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH

WORKDIR /app

# Dependencies first so code changes reuse the cached layer.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project

COPY src ./src
RUN uv sync --locked --no-dev

RUN useradd --create-home --uid 10001 modeling
USER modeling

ENTRYPOINT ["soundcheck-modeling"]
