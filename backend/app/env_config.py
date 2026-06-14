import os
from dotenv import load_dotenv

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_PATH = os.path.join(PROJECT_DIR, "data", ".env")

if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH, override=False)


def get_openai_api_key() -> str | None:
    return os.environ.get("OPENAI_API_KEY")


def get_openai_base_url() -> str:
    return os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")


def get_openai_model() -> str:
    return os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


def get_google_client_id() -> str:
    return os.environ.get("GOOGLE_CLIENT_ID", "")


def get_google_client_secret() -> str:
    return os.environ.get("GOOGLE_CLIENT_SECRET", "")


def get_oauth_redirect_uri() -> str:
    return os.environ.get("OAUTH_REDIRECT_URI", "http://127.0.0.1:8765/api/auth/google/callback")


def get_frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://127.0.0.1:5173")


def get_session_secret() -> str:
    return os.environ.get("SESSION_SECRET", "")


def get_cors_origins() -> str:
    return os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")


def get_default_user_email() -> str:
    return os.environ.get("DEFAULT_USER_EMAIL", "")


def get_env() -> str:
    return os.environ.get("ENV", "dev")
