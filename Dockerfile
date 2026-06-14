# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image
FROM python:3.12-slim

# Install nginx + system deps for scipy/yfinance
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx gcc g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY backend/ ./backend/

# Frontend build output → nginx
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default && \
    chmod -R 755 /usr/share/nginx/html

# Nginx runs on 80, uvicorn on 8000 (internal)
ENV PYTHONPATH=/app/backend
EXPOSE 80

# Start both nginx and uvicorn
CMD ["sh", "-c", "nginx && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
