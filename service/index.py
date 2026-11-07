"""Vercel FastAPI entrypoint; requires cloud secrets and PostgreSQL configuration."""
from app import from_env

app = from_env()
