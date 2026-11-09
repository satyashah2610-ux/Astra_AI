import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
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
    with TestClient(create_app(tmp_path)) as client:
        items = [upload(client).json() for _ in range(3)]
        assert [item['name'] for item in items] == ['Agreement', 'Agreement (1)', 'Agreement (2)']
        assert {item['filename'] for item in items} == {'Agreement.pdf'}
        assert len({item['id'] for item in items}) == 3
        save(client, items[0]['id'], [mark()])
        assert client.get(f"/api/agreements/{items[1]['id']}").json()['marks'] == []
    with TestClient(create_app(tmp_path)) as restarted:
        assert {item['name'] for item in restarted.get('/api/agreements').json()} == {'Agreement', 'Agreement (1)', 'Agreement (2)'}


def test_simultaneous_uploads_get_unique_names(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: upload(client), range(4)))
        assert all(response.status_code == 201 for response in responses)
        assert {response.json()['name'] for response in responses} == {'Agreement', 'Agreement (1)', 'Agreement (2)', 'Agreement (3)'}


def test_existing_duplicate_names_are_repaired_without_changing_documents(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        items = [upload(client, name=name).json() for name in ['Agreement.pdf', 'Duplicate.pdf', 'Agreement (1).pdf']]
        save(client, items[1]['id'], [mark()])
    # Model an older installation that predates unique naming.
    with sqlite3.connect(tmp_path / 'agreements.sqlite3') as db:
        db.execute('DROP INDEX IF EXISTS agreements_unique_name')
        db.execute('UPDATE agreements SET name = ? WHERE id = ?', ('Agreement', items[1]['id']))
    for _ in range(2):
        with TestClient(create_app(tmp_path)) as client:
            assert client.get(f"/api/agreements/{items[0]['id']}").json()['name'] == 'Agreement'
            duplicate = client.get(f"/api/agreements/{items[1]['id']}").json()
            assert duplicate['name'] == 'Agreement (2)'
            assert duplicate['marks'] == [mark()]
            assert duplicate['version'] == 1
            assert client.get(f"/api/agreements/{items[2]['id']}").json()['name'] == 'Agreement (1)'
            for item in items:
                assert client.get(f"/api/agreements/{item['id']}/pdf").status_code == 200
