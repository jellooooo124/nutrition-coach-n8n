"""Create ignored local configuration; never print secret values or overwrite keys."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
from cryptography.fernet import Fernet

p = argparse.ArgumentParser()
p.add_argument('spreadsheet_id')
p.add_argument('service_account_file', type=Path)
a = p.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_-]{20,}', a.spreadsheet_id): p.error('Invalid spreadsheet ID')
credentials = a.service_account_file.expanduser().resolve()
if not credentials.is_file(): p.error('Service account file does not exist; keep it outside tracked source')
root = Path(__file__).resolve().parents[1]
local = root / '.local'
local.mkdir(mode=0o700, exist_ok=True)
config = local / 'gateway.env'
values = {
    'NUTRITION_GATEWAY_KEY': secrets.token_hex(32),
    'NUTRITION_ENCRYPTION_KEY': Fernet.generate_key().decode(),
    'NUTRITION_DB_PATH': str(local / 'nutrition.sqlite'),
    'NUTRITION_SPREADSHEET_ID': a.spreadsheet_id,
    'GOOGLE_APPLICATION_CREDENTIALS': str(credentials),
}
fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    for name, value in values.items(): stream.write(name + '=' + json.dumps(value) + '\n')
print('Created .local/gateway.env. Keep its keys private and backed up with the database.')
print('No Google requests were made. Select the gateway key in n8n credentials locally; never paste it into chat.')
