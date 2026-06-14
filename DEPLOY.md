# equity.ark — Production Deploy

## Prerequisites
- Docker + Docker Compose installed
- Synology NAS with Docker support (or any Linux host)
- Domain `equity-ark.derycklong.synology.me` pointing to your host
- HTTPS configured (Synology reverse proxy or Let's Encrypt)

## 1. Update Google OAuth

Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and add the production redirect URI:

```
https://equity-ark.derycklong.synology.me/api/auth/google/callback
```

Also update the **Authorized JavaScript origins** to include:
```
https://equity-ark.derycklong.synology.me
```

## 2. Files on the host

Copy these files to your NAS:

```
equity-ark/
├── docker-compose.yml
├── data/
│   └── .env          (production values)
├── backend/data/
│   └── portfolio.db  (your existing database, if migrating)
└── frontend/dist/    (built frontend — or let the image handle it)
```

## 3. Deploy

```bash
# Pull and start
docker compose up -d

# Check logs
docker compose logs -f
```

## 4. Verify

1. Open `https://equity-ark.derycklong.synology.me`
2. Login with Google
3. Check `/api/health` — should return `"llm_enabled": true`

## 5. HTTPS (if not already configured)

On Synology DSM:
1. Go to **Control Panel → Login Portal → Advanced → Reverse Proxy**
2. Create a rule:
   - Source: `https://equity-ark.derycklong.synology.me`
   - Destination: `http://localhost:8080`
3. Enable Let's Encrypt certificate for the subdomain
