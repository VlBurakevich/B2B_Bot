"""Preserve the current bot credentials; prepare an independent Kaiten channel offline."""
import argparse
import os
from pathlib import Path
import re
import secrets
import tempfile
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
ASSIGN=re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=')
KEY=re.compile(r'^[a-f0-9]{64}$')

def read_values(path):
    result={}
    for line in Path(path).read_text().splitlines():
        match=ASSIGN.match(line)
        if not match:continue
        value=line[match.end():].strip()
        if len(value)>1 and value[0] in "\"'" and value[-1]==value[0]:value=value[1:-1]
        result[match[1]]=value
    return result

def rewrite(text,updates):
    lines=[]
    for line in text.splitlines():
        match=ASSIGN.match(line)
        if not match or match[1] not in updates:lines.append(line)
    lines.extend(f'{k}={v}' for k,v in updates.items())
    return '\n'.join(lines)+'\n'

def private_write(path,text):
    path=Path(path)
    if path.exists():
        backup=path.with_name(path.name+'.backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(3))
        fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:f.write(path.read_text())
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.env-stage-')
    try:
        with os.fdopen(fd,'w') as f:f.write(text)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def prepare(root,existing):
    root,existing=Path(root),Path(existing)
    original=existing.read_text();old=read_values(existing)
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+',old.get('TELEGRAM_TOKEN','')):raise ValueError('Existing TELEGRAM_TOKEN is missing or invalid')
    if not KEY.fullmatch(old.get('BRIDGE_KEY','')):raise ValueError('Existing B2B BRIDGE_KEY is missing or invalid')
    if old.get('B2B_ORIGIN')!='https://b2b.n-smena.business':raise ValueError('Check the existing B2B_ORIGIN before proceeding')
    if old.get('B2B_API_PROTOCOL','2')!='2':raise ValueError('This release preserves the deployed B2B protocol 2; review a different protocol explicitly')
    if old.get('TELEGRAM_USERNAME','nashasmena_b2b_login_bot')!='nashasmena_b2b_login_bot':raise ValueError('Unexpected bot username; check the intended bot')
    bot=root/'bot/.env';app=root/'kaiten/.env'
    candidates=[v for v in [old.get('KAITEN_TEST_BRIDGE_KEY',''),read_values(bot).get('KAITEN_TEST_BRIDGE_KEY',''),read_values(app).get('KAITEN_BRIDGE_KEY','')] if KEY.fullmatch(v)]
    if len(set(candidates))>1:raise ValueError('Kaiten keys differ between existing files; no files changed')
    key=candidates[0] if candidates else secrets.token_hex(32)
    if key==old['BRIDGE_KEY'] or key==old.get('KAITEN_BRIDGE_KEY'):raise ValueError('Kaiten test needs its own independent key')
    bot_text=rewrite(original,{'TELEGRAM_USERNAME':'nashasmena_b2b_login_bot','B2B_API_PROTOCOL':'2','BOT_DATA_DIR':'/app/data','BOT_BIND':'0.0.0.0','PORT':'3103','KAITEN_TEST_ORIGIN':'https://test-kaiten.n-smena.business','KAITEN_TEST_BRIDGE_KEY':key})
    app_text=rewrite(app.read_text(),{'KAITEN_BRIDGE_KEY':key})
    private_write(bot,bot_text);private_write(app,app_text)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--existing-bot-env',required=True,type=Path)
    args=p.parse_args()
    try:prepare(ROOT,args.existing_bot_env)
    except (ValueError,OSError) as e:raise SystemExit(str(e))
    print('Prepared bot/.env and kaiten/.env. Existing token/B2B key preserved; independent Kaiten key matched. Secrets were not printed. Fill the Compose volume settings in the root .env separately.')
