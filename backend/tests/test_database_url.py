"""The database address holds the password: it must never appear in an error or a log line."""
import logging
import traceback

import pytest

from app.database import clean_database_url, hide_password_in_logs
from app.main import create_app

PASSWORD = "npg_s3cretPassw0rd"
URL = f"postgresql://owner:{PASSWORD}@db.example.com/neondb?sslmode=require&channel_binding=require"


@pytest.mark.parametrize("pasted", [URL, f'"{URL}"', f"'{URL}'", f"  {URL}  ", f' "{URL}" ', f'"{URL}', f"{URL}'"])
def test_quotes_and_spaces_around_the_address_are_removed(pasted):
    assert clean_database_url(pasted) == URL


def test_the_key_value_form_is_left_as_it_is():
    keyword_form = f"host=db.example.com password={PASSWORD} options='-c search_path=test'"
    assert clean_database_url(keyword_form) == keyword_form


@pytest.mark.parametrize("bad", [f"postgresql://owner:{PASSWORD}@db.example.com/neondb?nonsense_option=1",
                                 f"psql '{URL}'"])
def test_a_malformed_address_is_refused_without_showing_it(bad):
    with pytest.raises(RuntimeError) as error:
        clean_database_url(bad)
    shown = "".join(traceback.format_exception(error.value))
    assert "DATABASE_URL" in shown and PASSWORD not in shown and "db.example.com" not in shown


def test_the_app_refuses_a_malformed_address_before_connecting(tmp_path):
    with pytest.raises(RuntimeError) as error:
        create_app(tmp_path, database_url=f"psql '{URL}'")
    assert PASSWORD not in "".join(traceback.format_exception(error.value))


def test_database_log_lines_never_show_the_password(caplog):
    hide_password_in_logs(URL)
    with caplog.at_level(logging.WARNING):
        logging.getLogger("psycopg.pool").warning("error connecting in 'pool-1': %s", f"bad option {URL}")
        logging.getLogger("psycopg").warning("connection failed for %s", URL)
    assert PASSWORD not in caplog.text and "***" in caplog.text
    assert "error connecting in 'pool-1'" in caplog.text  # the rest of the message stays useful


def test_an_encoded_password_is_hidden_in_both_spellings(caplog):
    url = "postgresql://owner:p%40ss%2Fw0rd-xyz@db.example.com/neondb"  # the password is p@ss/w0rd-xyz
    hide_password_in_logs(url)
    with caplog.at_level(logging.WARNING):
        logging.getLogger("psycopg.pool").warning("bad option %s", url)
        logging.getLogger("psycopg").warning("auth failed for p@ss/w0rd-xyz")
    assert "p%40ss%2Fw0rd-xyz" not in caplog.text and "p@ss/w0rd-xyz" not in caplog.text
