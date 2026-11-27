"""Offline configuration checks. Does not contact Telegram or modify a server."""
import argparse
from pathlib import Path
import re
from prepare_env import ROOT,KEY,read_values

def check(root,layout):
    root=Path(root);bot=read_values(root/'bot/.env');app=read_values(root/'kaiten/.env');stack=read_values(root/'.env')
    required={'KAITEN_BRIDGE_KEY':app.get('KAITEN_BRIDGE_KEY','')}
    if layout!='kaiten-vps':
        required.update({name:bot.get(name,'') for name in ['TELEGRAM_TOKEN','BRIDGE_KEY','KAITEN_TEST_BRIDGE_KEY']})
    for name,value in required.items():
        if not value or 'REPLACE' in value.upper():raise ValueError('Fill '+name)
    if not all(KEY.fullmatch(value) for name,value in required.items() if name!='TELEGRAM_TOKEN'):raise ValueError('Keys must be 64 lowercase hex characters')
    if layout!='kaiten-vps':
        if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+',bot['TELEGRAM_TOKEN']):raise ValueError('Invalid token format')
        if bot['BRIDGE_KEY']==bot['KAITEN_TEST_BRIDGE_KEY']:raise ValueError('B2B and Kaiten keys must differ')
        if bot['KAITEN_TEST_BRIDGE_KEY']!=app['KAITEN_BRIDGE_KEY']:raise ValueError('Bot/app Kaiten keys do not match')
        if bot.get('B2B_API_PROTOCOL')!='2':raise ValueError('Preserve B2B protocol 2')
        if bot.get('B2B_ORIGIN')!='https://b2b.n-smena.business':raise ValueError('Unexpected B2B origin')
        if bot.get('KAITEN_TEST_ORIGIN')!=app.get('PUBLIC_URL'):raise ValueError('Bot/app Kaiten origins must match')
        if bot.get('BOT_DATA_DIR')!='/app/data' or bot.get('BOT_BIND')!='0.0.0.0' or bot.get('PORT')!='3103':raise ValueError('Bot container bind/data configuration does not match Compose')
    if app.get('PUBLIC_URL')!='https://test-kaiten.n-smena.business':raise ValueError('Unexpected Kaiten test origin')
    if app.get('KAITEN_SERVICE_ID')!='kaiten-test' or app.get('KAITEN_BOT_ORIGIN')!='https://bot.n-smena.business':raise ValueError('Unexpected Kaiten channel settings')
    if app.get('DATA_DIR')!='/data' or app.get('COOKIE_SECURE')!='1':raise ValueError('Check application data directory and secure cookies')
    if layout!='kaiten-vps':
        for name in ['COMPOSE_PROJECT_NAME','BOT_STATE_VOLUME','CADDY_DATA_VOLUME','CADDY_CONFIG_VOLUME']:
            value=stack.get(name,'')
            if not value or 'REPLACE' in value.upper():raise ValueError('Fill '+name+' with the existing deployment value')
        if len({stack[k] for k in ['BOT_STATE_VOLUME','CADDY_DATA_VOLUME','CADDY_CONFIG_VOLUME']})!=3:raise ValueError('Existing bot/Caddy volumes must be distinct')
    if layout in ('single-host','kaiten-vps'):
        config=stack if layout=='single-host' else read_values(root/'deploy/kaiten-vps/.env')
        path=Path(config.get('KAITEN_DATA_DIR',''))
        if 'REPLACE' in str(path).upper() or not path.is_absolute() or not (path/'focus.sqlite3').is_file():raise ValueError('Prepare a separate Kaiten data copy and set its absolute KAITEN_DATA_DIR')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--layout',choices=['bot-only','single-host','kaiten-vps'],default='bot-only');args=p.parse_args()
    try:check(ROOT,args.layout)
    except (ValueError,OSError) as e:raise SystemExit(str(e))
    print('Configuration checks passed; secret values were not printed. Validate Compose and Caddy on the target server next.')
