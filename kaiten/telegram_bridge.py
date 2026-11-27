"""Signed Kaiten channel to an approved multi-service bot. Never polls Telegram."""
import hashlib
import hmac
import json
import re
import secrets
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen, HTTPRedirectHandler, build_opener

from access import AccessError


def validate_key(key):
    if not isinstance(key,str) or not re.fullmatch(r'[a-f0-9]{64}',key):
        raise ValueError('KAITEN_BRIDGE_KEY must be a separate 32-byte hex secret')


def signature(key,service,ts,nonce,path,raw):
    message='\n'.join(['kaiten-bot-v1',service,ts,nonce,'POST',path,hashlib.sha256(raw).hexdigest()])
    return hmac.new(bytes.fromhex(key),message.encode(),hashlib.sha256).hexdigest()


def signed_headers(key,service,path,raw,clock=time.time):
    validate_key(key)
    ts,nonce=str(int(clock())),secrets.token_hex(16)
    return {'Content-Type':'application/json','X-Kaiten-Service':service,'X-Kaiten-Time':ts,'X-Kaiten-Nonce':nonce,'X-Kaiten-Signature':signature(key,service,ts,nonce,path,raw)}


def authenticate(store,key,service,path,raw,headers):
    validate_key(key)
    ts,nonce,sig=headers.get('X-Kaiten-Time',''),headers.get('X-Kaiten-Nonce',''),headers.get('X-Kaiten-Signature','')
    if headers.get('X-Kaiten-Service')!=service or not re.fullmatch(r'[0-9]{10,12}',ts) or abs(store.clock()-int(ts))>60 or not re.fullmatch(r'[a-f0-9]{32}',nonce) or not re.fullmatch(r'[a-f0-9]{64}',sig):
        raise AccessError('Недопустимый запрос бота.',401)
    if not hmac.compare_digest(sig,signature(key,service,ts,nonce,path,raw)):
        raise AccessError('Недопустимый запрос бота.',401)
    with store.transaction() as conn:
        now=int(store.clock())
        conn.execute('DELETE FROM kaiten_bridge_nonces WHERE expires<=?',(now,))
        result=conn.execute('INSERT OR IGNORE INTO kaiten_bridge_nonces VALUES(?,?)',(nonce,now+120))
        if result.rowcount!=1:
            raise AccessError('Повторный запрос бота.',401)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


class BridgeClient:
    def __init__(self,origin,key,service,app_origin,*,allow_local=False,clock=time.time,opener=None):
        validate_key(key)
        url=urlsplit(origin)
        if not re.fullmatch(r'kaiten(?:-test)?',service) or url.username or url.password or url.query or url.fragment or url.path or origin!=f'{url.scheme}://{url.netloc}' or not (url.scheme=='https' or allow_local and url.scheme=='http' and url.hostname=='127.0.0.1'):
            raise ValueError('Invalid Kaiten bot bridge configuration')
        self.origin,self.key,self.service,self.app_origin,self.clock=origin,key,service,app_origin,clock
        self.opener=opener or build_opener(NoRedirect())

    def call(self,kind,payload):
        if kind not in ('health','code','notify'):
            raise ValueError('Unsupported bridge method')
        path=f'/bridge/{self.service}/{kind}'
        raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()
        req=Request(self.origin+path,raw,signed_headers(self.key,self.service,path,raw,self.clock),method='POST')
        try:
            with self.opener.open(req,timeout=12) as response:
                if response.status!=200:
                    raise RuntimeError()
                result=json.loads(response.read(16384))
            if result.get('ok') is not True:
                raise RuntimeError()
            return result
        except Exception:
            raise AccessError('Сервис Telegram временно недоступен.',503) from None

    def send(self,kind,payload):
        health=self.call('health',{})
        if health.get('protocol')!=3 or health.get('service')!=self.service or health.get('origin')!=self.app_origin or health.get('registration') is not True:
            raise AccessError('Общий бот ещё не подготовлен для Kaiten.',503)
        return self.call(kind,payload)
