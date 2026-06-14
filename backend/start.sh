#!/bin/bash
set -euo pipefail
cd /home/derycklong/vibe-code/equity-ark/backend
exec nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8765 > /tmp/be.log 2>&1
