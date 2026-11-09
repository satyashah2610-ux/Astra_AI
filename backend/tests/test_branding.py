from fastapi.testclient import TestClient

from app.main import create_app


def test_api_uses_astra_sign_product_name(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Astra Sign"
    assert "docusign" not in str(schema).casefold()
