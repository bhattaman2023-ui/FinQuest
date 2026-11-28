"""Shared, quiet PostgreSQL environment loading for ML service processes."""
from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv


DEFAULT_DOTENV_PATH = Path(__file__).resolve().parent.parent / "backend" / ".env"
_INVALID_PERCENT_ESCAPE = re.compile(r"%(?![0-9A-Fa-f]{2})")


class DatabaseConfigurationError(ValueError):
    """Raised with credential-free messages for invalid database settings."""


def validate_database_url(value: str | None) -> str:
    """Validate a PostgreSQL URL without including it in errors or logs."""
    if value is None or value == "":
        raise DatabaseConfigurationError("DATABASE_URL is not configured")
    if value != value.strip() or any(ch.isspace() for ch in value):
        raise DatabaseConfigurationError("DATABASE_URL is malformed")
    if _INVALID_PERCENT_ESCAPE.search(value):
        raise DatabaseConfigurationError(
            "DATABASE_URL contains an invalid percent escape; URL-encode special characters"
        )
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in {"postgres", "postgresql"}
            and bool(parsed.hostname)
            and bool(parsed.path.strip("/"))
        )
        # Accessing port validates malformed/out-of-range port values.
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            valid = False
    except ValueError as exc:
        raise DatabaseConfigurationError("DATABASE_URL is malformed") from exc
    if not valid:
        raise DatabaseConfigurationError(
            "DATABASE_URL must be a PostgreSQL URL with a host and database name"
        )
    return value


def get_database_url(dotenv_path: str | Path = DEFAULT_DOTENV_PATH) -> str:
    """Prefer process environment; otherwise load backend/.env without logging.

    The environment wins, matching the backend's dotenv/config behavior. The
    shared backend file is only read when DATABASE_URL is absent.
    """
    value = os.environ.get("DATABASE_URL")
    if value is None:
        load_dotenv(
            dotenv_path=dotenv_path,
            override=False,
            interpolate=False,
            encoding="utf-8",
        )
        value = os.environ.get("DATABASE_URL")
    return validate_database_url(value)
