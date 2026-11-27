"""Explicit operator binding after a verified Telegram contact; preview never migrates a database."""
import argparse
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from access import AccessStore

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--account-id',required=True)
    parser.add_argument('--telegram-id',required=True)
    parser.add_argument('--phone',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    folder=Path(os.environ.get('DATA_DIR',str(Path(__file__).resolve().parent/'data'))).resolve()
    database=folder/'focus.sqlite3'
    with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as conn:
        conn.row_factory=sqlite3.Row
        user=conn.execute('SELECT id,name,role FROM users WHERE id=?',(args.account_id,)).fetchone()
        if not user:raise SystemExit('Existing account not found')
        migrated=conn.execute("SELECT 1 FROM settings WHERE key='phone_auth_v1'").fetchone()
        print(json.dumps({'account':dict(user),'telegramId':args.telegram_id,'phone':args.phone,'action':'Bind verified contact to this exact existing ID; preserve all work data'},ensure_ascii=False))
    if not args.apply:
        print('Preview only: no database, identity or session changes.')
    elif not migrated:
        raise SystemExit('Prepare and review the phone migration in an isolated candidate first; this command will not migrate a live database.')
    else:
        key=folder/'phone-auth.key'
        if not key.is_file() or len(key.read_bytes())!=32:raise SystemExit('Prepare the candidate as its service user first; an existing auth key is required')
        store=AccessStore(database,key.read_bytes(),origin=os.environ.get('PUBLIC_URL','http://127.0.0.1:8088'))
        store.bind_existing(args.account_id,args.telegram_id,args.phone)
        print('Verified identity bound. Existing account ID and work data preserved.')
