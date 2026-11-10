from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.staff import StaffClient
from app.naming import unique_name
from test_agreements import upload, save, mark


@pytest.mark.parametrize('base,existing,expected', [
    ('Agreement', [], 'Agreement'),
    ('Agreement', ['Agreement'], 'Agreement (1)'),
    ('Agreement', ['Agreement', 'Agreement (1)'], 'Agreement (2)'),
    ('Agreement', ['Agreement', 'Agreement (2)'], 'Agreement (1)'),
    ('agreement', ['Agreement', 'AGREEMENT (1)'], 'agreement (2)'),
    ('Agreement (1)', ['Agreement (1)'], 'Agreement (1) (1)'),
    ('x' * 200, ['x' * 200], 'x' * 196 + ' (1)'),
])
def test_unique_display_name(base, existing, expected):
    assert unique_name(base, {name.casefold() for name in existing}) == expected


def test_duplicate_uploads_get_persisted_distinct_names(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        items = [upload(client).json() for _ in range(3)]
        assert [item['name'] for item in items] == ['Agreement', 'Agreement (1)', 'Agreement (2)']
        assert {item['filename'] for item in items} == {'Agreement.pdf'}
        assert len({item['id'] for item in items}) == 3
        save(client, items[0]['id'], [mark()])
        assert client.get(f"/api/agreements/{items[1]['id']}").json()['marks'] == []
    with StaffClient(create_app(tmp_path)) as restarted:
        assert {item['name'] for item in restarted.get('/api/agreements').json()} == {'Agreement', 'Agreement (1)', 'Agreement (2)'}


def test_simultaneous_uploads_get_unique_names(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: upload(client), range(4)))
        assert all(response.status_code == 201 for response in responses)
        assert {response.json()['name'] for response in responses} == {'Agreement', 'Agreement (1)', 'Agreement (2)', 'Agreement (3)'}


def test_the_database_itself_refuses_duplicate_names_in_any_case(tmp_path):
    import psycopg
    import pytest
    from tests import db
    with StaffClient(create_app(tmp_path)) as client:
        first = upload(client, name="Agreement.pdf").json()
        second = upload(client, name="Other.pdf").json()
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute("UPDATE agreements SET name = %s WHERE id = %s", ("AGREEMENT", second["id"]))
    assert db.value("SELECT name FROM agreements WHERE id = %s", (first["id"],)) == "Agreement"
