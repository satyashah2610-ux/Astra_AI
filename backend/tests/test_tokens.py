import re

from app.tokens import hash_token, new_token


def test_tokens_are_unique_url_safe_and_long():
    tokens = {new_token() for _ in range(200)}
    assert len(tokens) == 200
    for token in tokens:
        assert len(token) >= 43
        assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_hash_is_deterministic_hex_and_not_the_token():
    token = new_token()
    digest = hash_token(token)
    assert digest == hash_token(token)
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert digest != token
    assert hash_token(new_token()) != digest
