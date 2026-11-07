"""Synthetic draft gateway. The ledger and Google Sheets are NOT one transaction."""
from contextlib import contextmanager
from datetime import date
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import quote

from cryptography.fernet import Fernet
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import httpx
from pydantic import BaseModel, ConfigDict

COLUMNS = json.loads(Path(__file__).with_name('columns.json').read_text())


class Draft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    row: dict


def validate(kind, row):
    if kind not in COLUMNS or set(row) != set(COLUMNS[kind]):
        raise ValueError('ROW_FIELDS_INVALID')
    if any(not isinstance(v, str) or len(v) > 8000 for v in row.values()):
        raise ValueError('ROW_TYPES_INVALID')
    if len(json.dumps(row)) > 64000 or any('\x00' in v for v in row.values()):
        raise ValueError('ROW_SIZE_INVALID')
    client = row['client_id']
    if not re.fullmatch(r'TEST-[A-Za-z0-9_-]{1,100}', client):
        raise ValueError('SYNTHETIC_CLIENT_REQUIRED')
    if row['review_status'] != '待教練審核':
        raise ValueError('HUMAN_REVIEW_REQUIRED')
    for field in ('approved_text', 'coach_approved_text', 'manually_replied_at', 'manually_sent_at'):
        if row.get(field, '') != '':
            raise ValueError('HUMAN_FIELDS_MUST_BE_EMPTY')
    if kind == 'Meals' and (row['coach_goal_met'] != '待確認' or row['processing_status'] != 'AI草稿待教練審核'):
        raise ValueError('HUMAN_FIELDS_MUST_BE_EMPTY')
    draft = row.get('ai_client_draft', row.get('ai_draft', ''))
    if not draft.strip():
        raise ValueError('EMPTY_DRAFT')
    identifier = row[COLUMNS[kind][0]]
    if kind == 'Meals':
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', identifier):
            raise ValueError('INVALID_ID')
        date.fromisoformat(row['meal_date'])
    elif kind == 'Weekly_Summaries':
        if row['week_no'] not in [str(i) for i in range(1, 9)]:
            raise ValueError('INVALID_WEEK')
        if (date.fromisoformat(row['week_end']) - date.fromisoformat(row['week_start'])).days != 6:
            raise ValueError('INVALID_WEEK_RANGE')
        if identifier != f"WEEK|{client}|{row['week_no']}":
            raise ValueError('INVALID_ID')
    else:
        field, prefix = ('report_date', 'DAY') if kind == 'Daily_Summaries' else ('reminder_date', 'NOLOG')
        date.fromisoformat(row[field])
        if identifier != f'{prefix}|{client}|{row[field]}':
            raise ValueError('INVALID_ID')
    return identifier


class GoogleSheets:
    """Fixed spreadsheet only. No arbitrary URL/range or token accepted from callers."""
    def __init__(self, spreadsheet, credentials_path=None, credentials_info=None):
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,}', spreadsheet):
            raise RuntimeError('Configure NUTRITION_SPREADSHEET_ID')
        from google.oauth2 import service_account
        self.credentials_info = credentials_info or json.loads(Path(credentials_path).read_text())
        service_account.Credentials.from_service_account_info(
            self.credentials_info, scopes=['https://www.googleapis.com/auth/spreadsheets'])
        self.root = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheet + '/values/'

    def headers(self):
        # google-auth's refresh transport uses requests; use the supported httpx
        # request adapter below to avoid another HTTP dependency.
        import google.auth.transport
        class Response(google.auth.transport.Response):
            def __init__(self, response): self.response = response
            @property
            def status(self): return self.response.status_code
            @property
            def headers(self): return dict(self.response.headers)
            @property
            def data(self): return self.response.content
        class Request(google.auth.transport.Request):
            def __call__(self, url, method='GET', body=None, headers=None, timeout=20, **kwargs):
                return Response(httpx.request(method, url, content=body, headers=headers, timeout=timeout, follow_redirects=False))
        # A fresh credentials object avoids shared refresh state across threads.
        from google.oauth2 import service_account
        credential = service_account.Credentials.from_service_account_info(
            self.credentials_info, scopes=['https://www.googleapis.com/auth/spreadsheets'])
        credential.refresh(Request())
        return {'Authorization': 'Bearer ' + credential.token}

    def inspect(self, kind, identifier):
        response = httpx.get(self.root + quote(f"'{kind}'!A1:Z", safe=''), headers=self.headers(), timeout=20)
        response.raise_for_status()
        rows = response.json().get('values', [])
        if not rows or rows[0] != COLUMNS[kind]:
            raise ValueError('SHEET_HEADER_MISMATCH')
        matches = [row for row in rows[1:] if row and row[0] == identifier]
        if len(matches) > 1:
            raise ValueError('DUPLICATE_SHEET_IDS')
        return bool(matches)

    def append(self, kind, row):
        response = httpx.post(self.root + quote(f"'{kind}'!A1", safe='') + ':append',
            params={'valueInputOption': 'RAW', 'insertDataOption': 'INSERT_ROWS'},
            headers=self.headers(), json={'values': [[row[c] for c in COLUMNS[kind]]]}, timeout=20)
        response.raise_for_status()
        if response.json().get('updates', {}).get('updatedRows') != 1:
            raise ValueError('APPEND_RESULT_UNCERTAIN')


class Ledger:
    def __init__(self, path, encryption_key):
        self.path = path
        self.cipher = Fernet(encryption_key)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS drafts (kind TEXT, id TEXT, state TEXT, payload BLOB, updated REAL, PRIMARY KEY(kind,id))')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db: yield db
        finally: db.close()

    def reserve(self, kind, identifier, row):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            found = db.execute('SELECT state,payload FROM drafts WHERE kind=? AND id=?', (kind,identifier)).fetchone()
            if found:
                original = json.loads(self.cipher.decrypt(found[1]))
                if original['client_id'] != row['client_id']:
                    raise ValueError('ID_CLIENT_CONFLICT')
                if found[0] == 'RETRYABLE':
                    db.execute('UPDATE drafts SET state=?,updated=? WHERE kind=? AND id=?', ('RESERVED',time.time(),kind,identifier))
                    return True, 'RESERVED'
                return False, found[0]
            payload = self.cipher.encrypt(json.dumps(row, ensure_ascii=False).encode())
            db.execute('INSERT INTO drafts VALUES (?,?,?,?,?)', (kind,identifier,'RESERVED',payload,time.time()))
            return True, 'RESERVED'

    def state(self, kind, identifier, state):
        with self.db() as db:
            db.execute('UPDATE drafts SET state=?,updated=? WHERE kind=? AND id=?', (state,time.time(),kind,identifier))

    def reconcile(self, kind, identifier, sheets):
        # Read-only remote reconciliation: never automatically repeat an append.
        if sheets.inspect(kind, identifier):
            self.state(kind, identifier, 'DELIVERED')
            return 'DELIVERED'
        return 'REVIEW_REQUIRED'


def create_app(ledger, sheets, key):
    if not key or len(key) < 32:
        raise RuntimeError('NUTRITION_GATEWAY_KEY must contain at least 32 random characters')
    app = FastAPI(title='Synthetic Nutrition Draft Gateway', docs_url=None, redoc_url=None, openapi_url=None)

    app.add_middleware(RequestBoundary, key=key)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        return JSONResponse(status_code=422, content={'detail': 'REQUEST_SCHEMA_INVALID'})

    def auth(x_nutrition_key: str | None = Header(default=None)):
        if not x_nutrition_key or not hmac.compare_digest(key.encode(), x_nutrition_key.encode()):
            raise HTTPException(401, 'AUTHENTICATION_REQUIRED')

    @app.get('/health')
    def health(): return {'ok': True, 'synthetic_only': True}

    @app.get('/v1/jobs', dependencies=[Depends(auth)])
    def jobs():
        with ledger.db() as db:
            rows = db.execute('SELECT kind,id,state,updated FROM drafts ORDER BY updated DESC LIMIT 100').fetchall()
        return {'jobs': [dict(zip(['kind','id','state','updated'], row)) for row in rows]}

    @app.post('/v1/drafts/{kind}', dependencies=[Depends(auth)])
    def save(kind: str, body: Draft):
        try:
            identifier = validate(kind, body.row)
            owner, state = ledger.reserve(kind, identifier, body.row)
        except ValueError:
            raise HTTPException(422, 'DRAFT_SCHEMA_INVALID') from None
        if not owner:
            if state == 'DELIVERED': return {'id': identifier, 'state': state, 'duplicate': True}
            # A competing/previous worker may still be writing. No new writer
            # gets ownership, even after restart or an ambiguous network timeout.
            raise HTTPException(409, 'WRITE_PENDING_OR_UNCERTAIN_CHECK_JOBS')
        writing = False
        try:
            if sheets.inspect(kind, identifier):
                ledger.state(kind, identifier, 'DELIVERED')
                return {'id': identifier, 'state': 'DELIVERED', 'duplicate': True}
            ledger.state(kind, identifier, 'WRITING')
            writing = True
            sheets.append(kind, body.row)
            ledger.state(kind, identifier, 'DELIVERED')
        except Exception:
            ledger.state(kind, identifier, 'REVIEW_REQUIRED' if writing else 'RETRYABLE')
            raise HTTPException(503, 'SHEETS_WRITE_UNCERTAIN_RECONCILE_BEFORE_RETRY') from None
        return {'id': identifier, 'state': 'DELIVERED', 'duplicate': False}

    @app.post('/v1/reconcile/{kind}/{identifier:path}', dependencies=[Depends(auth)])
    def reconcile(kind: str, identifier: str):
        if kind not in COLUMNS or len(identifier) > 240: raise HTTPException(422, 'INVALID_REFERENCE')
        with ledger.db() as db:
            found = db.execute('SELECT state FROM drafts WHERE kind=? AND id=?', (kind,identifier)).fetchone()
        if not found: raise HTTPException(404, 'JOB_NOT_FOUND')
        try: state = ledger.reconcile(kind, identifier, sheets)
        except Exception: raise HTTPException(503, 'SHEETS_RECONCILIATION_FAILED') from None
        return {'id': identifier, 'state': state, 'automatic_rewrite': False}
    return app


class PostgresLedger(Ledger):
    """Shared cloud ledger; apply schema.sql once before deployment."""
    def __init__(self, url, encryption_key, sslmode='require'):
        if not url.startswith(('postgresql://', 'postgres://')):
            raise RuntimeError('PostgreSQL connection URL required')
        if sslmode not in ('require', 'verify-full', 'disable'):
            raise RuntimeError('Unsupported TLS mode')
        self.url, self.sslmode = url, sslmode
        self.cipher = Fernet(encryption_key)

    @contextmanager
    def db(self):
        import psycopg
        with psycopg.connect(self.url, sslmode=self.sslmode, connect_timeout=10) as connection:
            # Keep parameterized SQL consistent across the two testable adapters.
            class Session:
                def execute(self, sql, args=()):
                    return connection.execute(sql.replace('?', '%s'), args)
            yield Session()

    def reserve(self, kind, identifier, row):
        payload = self.cipher.encrypt(json.dumps(row, ensure_ascii=False).encode())
        with self.db() as db:
            created = db.execute('INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT (kind,id) DO NOTHING RETURNING state',
                                 (kind,identifier,'RESERVED',payload,time.time())).fetchone()
            if created: return True, 'RESERVED'
            found = db.execute('SELECT state,payload FROM drafts WHERE kind=? AND id=? FOR UPDATE', (kind,identifier)).fetchone()
            original = json.loads(self.cipher.decrypt(bytes(found[1])))
            if original['client_id'] != row['client_id']: raise ValueError('ID_CLIENT_CONFLICT')
            if found[0] == 'RETRYABLE':
                db.execute('UPDATE drafts SET state=?,updated=? WHERE kind=? AND id=?', ('RESERVED',time.time(),kind,identifier))
                return True, 'RESERVED'
            return False, found[0]


class RequestBoundary:
    """Authenticate before body parsing; bound streamed bodies; redact unexpected errors."""
    def __init__(self, app, key): self.app, self.key = app, key.encode()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http': return await self.app(scope, receive, send)
        if scope['path'] != '/health':
            keys = [v for k,v in scope['headers'] if k.lower() == b'x-nutrition-key']
            if len(keys) != 1 or not hmac.compare_digest(keys[0], self.key):
                return await JSONResponse({'detail': 'AUTHENTICATION_REQUIRED'}, status_code=401)(scope, receive, send)
        chunks, total = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect': return
            chunk = message.get('body', b'')
            total += len(chunk)
            if total > 131072:
                return await JSONResponse({'detail': 'REQUEST_TOO_LARGE'}, status_code=413)(scope, receive, send)
            chunks.append(chunk)
            if not message.get('more_body'): break
        delivered = False
        started = False
        async def replay():
            nonlocal delivered
            if delivered: return await receive()
            delivered = True
            return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
        async def safe_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                message['headers'] = message.get('headers', []) + [(b'cache-control', b'no-store')]
            await send(message)
        try: await self.app(scope, replay, safe_send)
        except Exception:
            if not started:
                await JSONResponse({'detail': 'GATEWAY_UNAVAILABLE_CHECK_SERVICE'}, status_code=503)(scope, receive, safe_send)


def from_env():
    database_url = os.environ.get('NUTRITION_DATABASE_URL')
    if database_url:
        ledger = PostgresLedger(database_url, os.environ['NUTRITION_ENCRYPTION_KEY'])
    else:
        if os.environ.get('VERCEL'):
            raise RuntimeError('Cloud deployment requires persistent PostgreSQL; SQLite fallback is forbidden')
        ledger = Ledger(os.environ['NUTRITION_DB_PATH'], os.environ['NUTRITION_ENCRYPTION_KEY'])
    info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON']) if os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON') else None
    sheets = GoogleSheets(os.environ['NUTRITION_SPREADSHEET_ID'], os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'), info)
    return create_app(ledger, sheets, os.environ['NUTRITION_GATEWAY_KEY'])
