import concurrent.futures
import copy
import importlib.util
from pathlib import Path
import secrets
import os
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
import threading
import time

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import httpx
import pytest

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).parents[1] / 'app.py')
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Sheets:
    def __init__(self):
        self.rows = {}
        self.appends = 0
        self.fail_read = False
        self.lose_ack = False
        self.lock = threading.Lock()

    def inspect(self, kind, identifier):
        if self.fail_read: raise ConnectionError('synthetic failed read')
        with self.lock: return (kind, identifier) in self.rows

    def append(self, kind, row):
        time.sleep(.02)
        with self.lock:
            self.appends += 1
            self.rows[kind, row[gateway.COLUMNS[kind][0]]] = copy.deepcopy(row)
        if self.lose_ack: raise TimeoutError('remote accepted; response lost')


@pytest.fixture
def fixture(tmp_path):
    key, encryption = secrets.token_hex(32), Fernet.generate_key()
    url = os.environ.get('PG_TEST_URL')
    if url:
        import psycopg
        schema = 'test_' + secrets.token_hex(12)
        with psycopg.connect(url) as db:
            db.execute(psycopg.sql.SQL('CREATE SCHEMA {}').format(psycopg.sql.Identifier(schema)))
            db.execute(psycopg.sql.SQL('SET search_path TO {}').format(psycopg.sql.Identifier(schema)))
            db.execute((Path(__file__).parents[1] / 'schema.sql').read_text())
        parts = urlsplit(url)
        scoped = urlunsplit(parts._replace(query=urlencode(parse_qsl(parts.query) + [('options', '-csearch_path=' + schema)])))
        ledger = gateway.PostgresLedger(scoped, encryption, sslmode='disable')
    else:
        ledger = gateway.Ledger(str(tmp_path / 'ledger.sqlite'), encryption)
    sheets = Sheets()
    client = TestClient(gateway.create_app(ledger, sheets, key))
    row = {k: '' for k in gateway.COLUMNS['Meals']}
    row.update(submission_id='FORM-TEST-001', client_id='TEST-001', meal_date='2026-11-06',
               meal_type='午餐', ai_client_draft='Synthetic draft for review only',
               review_status='待教練審核', coach_goal_met='待確認', processing_status='AI草稿待教練審核')
    yield client, ledger, sheets, {'X-Nutrition-Key': key}, row, encryption
    if url:
        with psycopg.connect(url) as db:
            db.execute(psycopg.sql.SQL('DROP SCHEMA {} CASCADE').format(psycopg.sql.Identifier(schema)))


def reopened(ledger, encryption):
    if isinstance(ledger, gateway.PostgresLedger):
        return gateway.PostgresLedger(ledger.url, encryption, sslmode='disable')
    return gateway.Ledger(ledger.path, encryption)


def post(f, row=None):
    client, _, _, headers, sample, _ = f
    return client.post('/v1/drafts/Meals', headers=headers, json={'row': row or sample})


def test_concurrent_connections_have_one_writer(fixture):
    client, ledger, sheets, headers, row, encryption = fixture
    def send(_):
        # Separate app and ledger instances share only the same persistent database.
        other = reopened(ledger, encryption)
        return TestClient(gateway.create_app(other, sheets, headers['X-Nutrition-Key'])).post(
            '/v1/drafts/Meals', headers=headers, json={'row': row}).status_code
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        codes = list(pool.map(send, range(24)))
    assert set(codes) <= {200, 409}
    assert 200 in codes
    assert sheets.appends == 1
    assert post(fixture).json()['duplicate'] is True


def test_lost_ack_reconciles_without_overwriting_human_edit(fixture):
    client, ledger, sheets, headers, row, encryption = fixture
    sheets.lose_ack = True
    assert post(fixture).status_code == 503
    sheets.rows['Meals', row['submission_id']]['coach_approved_text'] = 'Human edit must survive'
    assert post(fixture).status_code == 409
    restarted = TestClient(gateway.create_app(reopened(ledger, encryption), sheets, headers['X-Nutrition-Key']))
    result = restarted.post('/v1/reconcile/Meals/' + row['submission_id'], headers=headers)
    assert result.json()['state'] == 'DELIVERED'
    assert post(fixture).json()['duplicate'] is True
    assert sheets.appends == 1
    assert sheets.rows['Meals', row['submission_id']]['coach_approved_text'] == 'Human edit must survive'


def test_restart_with_uncertain_no_row_never_replays_append(fixture):
    client, ledger, sheets, headers, row, _ = fixture
    ledger.reserve('Meals', row['submission_id'], row)
    ledger.state('Meals', row['submission_id'], 'WRITING')
    assert client.post('/v1/reconcile/Meals/' + row['submission_id'], headers=headers).json()['state'] == 'REVIEW_REQUIRED'
    assert post(fixture).status_code == 409
    assert sheets.appends == 0


def test_prewrite_read_failure_can_retry_safely(fixture):
    _, _, sheets, _, _, _ = fixture
    sheets.fail_read = True
    assert post(fixture).status_code == 503
    assert sheets.appends == 0
    sheets.fail_read = False
    assert post(fixture).status_code == 200
    assert sheets.appends == 1


def test_existing_sheet_row_is_adopted_without_changes(fixture):
    _, _, sheets, _, row, _ = fixture
    sheets.rows['Meals', row['submission_id']] = {'coach_approved_text': 'Existing review'}
    assert post(fixture).json()['duplicate'] is True
    assert sheets.appends == 0


@pytest.mark.parametrize('change', [
    {'client_id': 'REAL-001'}, {'review_status': '已核准'}, {'coach_approved_text': 'Injected approval'},
    {'coach_goal_met': '是'}, {'ai_client_draft': {}}, {'ai_client_draft': ''},
    {'unexpected': 'bad'}, {'meal_date': '2026-02-31'}, {'ai_client_draft': 'x' * 8001},
])
def test_schema_and_human_boundaries(fixture, change):
    row = {**fixture[4], **change}
    assert post(fixture, row).status_code == 422
    assert fixture[2].appends == 0


def test_auth_errors_do_not_echo_secrets_or_payload(fixture):
    client, _, sheets, headers, row, _ = fixture
    private = 'synthetic content must not be echoed'
    for path in ['/v1/drafts/Meals', '/v1/reconcile/Meals/FORM-TEST-001']:
        result = client.post(path, json={'row': row}, headers={'X-Nutrition-Key': 'wrong'})
        assert result.status_code == 401
        assert headers['X-Nutrition-Key'] not in result.text
    result = client.post('/v1/drafts/Meals', headers=headers, json={'row': private})
    assert result.status_code == 422 and private not in result.text
    assert client.get('/v1/jobs').status_code == 401
    assert sheets.appends == 0


def test_payload_encrypted_and_job_view_redacted(fixture):
    client, ledger, _, headers, row, _ = fixture
    assert post(fixture).status_code == 200
    with ledger.db() as db:
        cipher = db.execute('SELECT payload FROM drafts').fetchone()[0]
    assert row['ai_client_draft'].encode() not in cipher
    assert json_body(client.get('/v1/jobs', headers=headers))['jobs'][0]['state'] == 'DELIVERED'
    assert row['ai_client_draft'] not in client.get('/v1/jobs', headers=headers).text


def json_body(response):
    assert response.status_code == 200
    return response.json()


def test_google_adapter_checks_headers_uses_raw_and_never_updates(monkeypatch):
    sheets = object.__new__(gateway.GoogleSheets)
    sheets.root = 'https://sheets.googleapis.com/v4/spreadsheets/SYNTHETIC/values/'
    sheets.headers = lambda: {'Authorization': 'Bearer synthetic-test-only'}
    calls = []
    def get(url, **kwargs):
        calls.append(('GET', url, kwargs))
        return httpx.Response(200, json={'values': [gateway.COLUMNS['Meals']]}, request=httpx.Request('GET', url))
    def append(url, **kwargs):
        calls.append(('POST', url, kwargs))
        return httpx.Response(200, json={'updates': {'updatedRows': 1}}, request=httpx.Request('POST', url))
    monkeypatch.setattr(gateway.httpx, 'get', get)
    monkeypatch.setattr(gateway.httpx, 'post', append)
    assert sheets.inspect('Meals', 'FORM-TEST-001') is False
    sheets.append('Meals', {c: '' for c in gateway.COLUMNS['Meals']})
    assert calls[-1][2]['params']['valueInputOption'] == 'RAW'
    assert calls[-1][1].endswith(':append')


def test_body_limit_and_auth_before_parsing(fixture):
    client, _, sheets, headers, _, _ = fixture
    assert client.post('/v1/drafts/Meals', content='{' * 150000).status_code == 401
    assert client.post('/v1/drafts/Meals', content='{' * 150000, headers=headers).status_code == 413
    assert sheets.appends == 0


def test_database_error_is_redacted(fixture, monkeypatch):
    client, ledger, _, headers, _, _ = fixture
    def fail(*args): raise RuntimeError('SECRET_DATABASE_URL')
    monkeypatch.setattr(ledger, 'reserve', fail)
    response = post(fixture)
    assert response.status_code == 503
    assert 'SECRET_DATABASE_URL' not in response.text
    assert response.headers['cache-control'] == 'no-store'


def test_cloud_never_falls_back_to_local_disk(monkeypatch):
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.delenv('NUTRITION_DATABASE_URL', raising=False)
    with pytest.raises(RuntimeError, match='persistent PostgreSQL'):
        gateway.from_env()
