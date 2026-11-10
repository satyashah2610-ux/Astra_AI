# Astra Sign: one container serving the API and the built web pages (hosted on Render with a persistent disk).

# 1. Build the web pages.
FROM node:24.12.0-slim AS pages
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts ./scripts
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. The app.
FROM python:3.14.2-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY backend/app ./app
COPY --from=pages /app/frontend/dist /app/frontend/dist
ENV ASTRA_FRONTEND_DIR=/app/frontend/dist
# --no-proxy-headers: the app reads the visitor's address itself (ASTRA_TRUSTED_PROXIES), never uvicorn's own rules.
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-10000} --no-proxy-headers"]
