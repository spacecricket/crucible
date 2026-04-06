FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY backend/pyproject.toml ./backend/pyproject.toml
RUN pip install --no-cache-dir ./backend

# Copy source
COPY backend/ ./backend/

EXPOSE 8080

CMD ["uvicorn", "backend.main:app", "--host", "::", "--port", "8080"]
