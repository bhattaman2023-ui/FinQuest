import sys
from pathlib import Path

import pytest

ML_DIR = Path(__file__).resolve().parents[1]
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from db_config import DatabaseConfigurationError, get_database_url, validate_database_url


def test_process_database_url_takes_precedence_over_dotenv(monkeypatch, tmp_path):
    dotenv = tmp_path / ".env"
    dotenv.write_text("DATABASE_URL=postgresql://dotenv-user:dotenv-pass@db.example.test/app\n", encoding="utf-8")
    monkeypatch.setenv("DATABASE_URL", "postgresql://env-user:env-pass@localhost:5432/app")

    assert get_database_url(dotenv) == "postgresql://env-user:env-pass@localhost:5432/app"


def test_missing_process_url_loads_shared_dotenv_without_printing_values(monkeypatch, tmp_path, capsys):
    dotenv = tmp_path / ".env"
    expected = "postgresql://db-user:encoded%40pass@localhost:5432/finquest"
    dotenv.write_text(f"DATABASE_URL={expected}\n", encoding="utf-8")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert get_database_url(dotenv) == expected
    assert capsys.readouterr().out == ""


def test_dotenv_loading_does_not_interpolate_url_contents(monkeypatch, tmp_path):
    dotenv = tmp_path / ".env"
    expected = "postgresql://db-user:pass%24%7BNAME%7D@localhost:5432/finquest"
    dotenv.write_text(f"DATABASE_URL={expected}\n", encoding="utf-8")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("NAME", "must-not-be-substituted")

    assert get_database_url(dotenv) == expected


def test_percent_encoded_password_and_supported_postgres_schemes_are_valid():
    url = "postgresql://user:part%40secret@localhost:5432/finquest"
    assert validate_database_url(url) == url
    assert validate_database_url("postgres://user@localhost/finquest") == "postgres://user@localhost/finquest"


@pytest.mark.parametrize("url", [
    None,
    "",
    "mysql://user:pass@localhost/finquest",
    "postgresql://user:bad%escape@localhost/finquest",
    "postgresql://user:pass@localhost",
    "postgresql://user:pass@localhost:99999/finquest",
])
def test_invalid_database_urls_raise_credential_free_errors(url):
    with pytest.raises(DatabaseConfigurationError) as error:
        validate_database_url(url)
    assert "bad%escape" not in str(error.value)
    assert "pass" not in str(error.value)
