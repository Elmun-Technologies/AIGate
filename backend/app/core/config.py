import os
from decimal import Decimal


class Settings:
    PROJECT_NAME = "Agent Proxy Gateway"
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://gateway:gateway@localhost:5432/gateway",
    )
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
    JWT_ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    API_KEY_SALT = os.getenv("API_KEY_SALT", "change-me")
    MOCK_TOOLS_BASE_URL = os.getenv("MOCK_TOOLS_BASE_URL", "http://localhost:9000")
    CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
    SPEND_DAILY_THRESHOLD_USD = Decimal(os.getenv("SPEND_DAILY_THRESHOLD_USD", "100"))
    SPEND_SPIKE_PERCENT = Decimal(os.getenv("SPEND_SPIKE_PERCENT", "300"))


settings = Settings()
