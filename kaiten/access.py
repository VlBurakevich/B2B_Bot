"""Phone/Telegram identities and access decisions. No Telegram tokens or plaintext codes in SQLite."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager, closing
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

CATALOG = {
    'platform.full_access': 'Вход в Kaiten',
    'projects.read': 'Просмотр доступных проектов',
    'projects.create': 'Создание проектов',
    'projects.manage': 'Управление своими проектами',
    'tasks.read': 'Просмотр доступных задач',
    'tasks.create': 'Создание задач себе',
    'tasks.edit': 'Изменение своих и совместных задач',
    'tasks.assign': 'Назначение задач сотрудникам',
    'company.tasks.read': 'Просмотр проектов и задач всей компании',
    'files.read': 'Скачивание файлов доступных задач',
    'files.upload': 'Прикрепление и удаление файлов',
    'comments.create': 'Комментарии в доступных задачах',
    'calendar.read': 'Календарь задач',
    'admin.access.manage': 'Заявки, права и управление доступом',
}
EMPLOYEE = [p for p in CATALOG if p not in ('tasks.assign', 'company.tasks.read', 'admin.access.manage')]
ADMIN = list(CATALOG)
NEUTRAL = {'ok': True, 'message': 'Если доступ разрешён, код придёт в Telegram.', 'expiresIn': 600, 'retryAfter': 60}
INVALID = 'Код недействителен или истёк. Запросите новый.'
TZ = ZoneInfo('Europe/Moscow')


class AccessError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def stamp():
    return datetime.now(TZ).isoformat(timespec='seconds')


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_phone(value):
    if not isinstance(value, str) or len(value) > 40 or not re.fullmatch(r'[+0-9\s()\-]+', value):
        return None
    digits = re.sub(r'[^0-9]', '', value)
    if len(digits) == 10:
        digits = '7' + digits
    if len(digits) == 11 and digits.startswith('8'):
        digits = '7' + digits[1:]
    return '+' + digits if re.fullmatch(r'7\d{10}', digits, re.ASCII) else None


def load_secret(folder):
    path = Path(folder)/'phone-auth.key'
    candidate=path.with_name('.phone-auth.'+secrets.token_hex(12))
    fd=os.open(candidate,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'wb') as file:
            file.write(secrets.token_bytes(32))
            file.flush()
            os.fsync(file.fileno())
        try:
            os.link(candidate,path)
        except FileExistsError:
            pass
    finally:
        candidate.unlink(missing_ok=True)
    secret = path.read_bytes()
    if len(secret) != 32:
        raise RuntimeError('Invalid phone authentication key')
    return secret


def migrate(conn):
    additions = {'status': "TEXT NOT NULL DEFAULT 'pending'", 'phone': 'TEXT', 'telegram_id': 'TEXT',
                 'telegram_username': 'TEXT', 'telegram_verified_at': 'INTEGER', 'registered_at': 'TEXT',
                 'reviewed_at': 'TEXT', 'updated_at': 'TEXT', 'access_version': 'INTEGER NOT NULL DEFAULT 1',
                 'auth_epoch': 'INTEGER NOT NULL DEFAULT 0', 'linked_to': 'TEXT REFERENCES users(id)'}
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('BEGIN IMMEDIATE')
    columns = {r[1] for r in conn.execute('PRAGMA table_info(users)')}
    for key, definition in additions.items():
        if key not in columns:
            conn.execute(f'ALTER TABLE users ADD COLUMN {key} {definition}')
    if 'auth_epoch' not in {r[1] for r in conn.execute('PRAGMA table_info(sessions)')}:
        conn.execute('ALTER TABLE sessions ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0')
    if 'task_id' not in {r[1] for r in conn.execute('PRAGMA table_info(outbox)')}:
        conn.execute('ALTER TABLE outbox ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE')
    # No executescript inside a migration transaction (it would commit implicitly).
    statements = [
        'CREATE UNIQUE INDEX IF NOT EXISTS users_phone_current ON users(phone) WHERE linked_to IS NULL AND phone IS NOT NULL',
        'CREATE UNIQUE INDEX IF NOT EXISTS users_tg_current ON users(telegram_id) WHERE linked_to IS NULL AND telegram_id IS NOT NULL',
        'CREATE TABLE IF NOT EXISTS access_permissions(user_id TEXT NOT NULL REFERENCES users(id),permission TEXT NOT NULL,PRIMARY KEY(user_id,permission))',
        'CREATE TABLE IF NOT EXISTS access_audit(id INTEGER PRIMARY KEY,actor_id TEXT,subject_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS phone_challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id),phone TEXT NOT NULL UNIQUE,telegram_id TEXT NOT NULL,epoch INTEGER NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,delivered INTEGER NOT NULL DEFAULT 0)',
        'CREATE TABLE IF NOT EXISTS phone_limits(key TEXT PRIMARY KEY,expires INTEGER NOT NULL,count INTEGER NOT NULL)',
        'CREATE TABLE IF NOT EXISTS phone_cooldowns(key TEXT PRIMARY KEY,next_at INTEGER NOT NULL)',
        'CREATE TABLE IF NOT EXISTS registration_drafts(telegram_id TEXT PRIMARY KEY,phone TEXT NOT NULL UNIQUE,username TEXT,verified_at INTEGER NOT NULL,expires INTEGER NOT NULL)',
        'CREATE TABLE IF NOT EXISTS registration_events(event_id TEXT PRIMARY KEY,response TEXT NOT NULL,created_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS access_outbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subject_id TEXT,kind TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,sent INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS kaiten_bridge_nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL)',
    ]
    for sql in statements:
        conn.execute(sql)
    if not conn.execute("SELECT 1 FROM settings WHERE key='phone_auth_v1'").fetchone():
        for row in conn.execute('SELECT id,role,active,created_at FROM users').fetchall():
            identifier, role, active, created = row
            conn.execute('UPDATE users SET status=?,updated_at=?,registered_at=?,auth_epoch=auth_epoch+1 WHERE id=?',
                         ('active' if active else 'blocked', stamp(), created, identifier))
            for permission in ADMIN if role == 'admin' else EMPLOYEE:
                conn.execute('INSERT OR IGNORE INTO access_permissions VALUES(?,?)', (identifier, permission))
        conn.execute('DELETE FROM sessions')
        conn.execute('UPDATE invites SET used=1')
        conn.execute('DELETE FROM telegram_codes')
        conn.execute('UPDATE outbox SET sent=2 WHERE sent=0')
        # Legacy telegram_chat is not proof that contact.user_id matched the sender.
        conn.execute("INSERT INTO settings VALUES('phone_auth_v1','1')")
        audit(conn, None, None, 'migration.phone_only', {'accountsPreserved': True})
    conn.commit()


def audit(conn, actor, subject, action, detail=None):
    conn.execute('INSERT INTO access_audit(actor_id,subject_id,action,detail,created_at) VALUES(?,?,?,?,?)',
                 (actor, subject, action, json.dumps(detail or {}, ensure_ascii=False), stamp()))


def permissions(conn, identifier):
    return [r[0] for r in conn.execute('SELECT permission FROM access_permissions WHERE user_id=? ORDER BY permission', (identifier,))]


def public_user(conn, identifier, private=False):
    row = conn.execute('SELECT * FROM users WHERE id=?', (identifier,)).fetchone()
    if not row:
        return None
    user = dict(row)
    fields = ['id', 'name', 'role', 'active', 'status', 'phone', 'access_version', 'linked_to']
    if private:
        fields += ['telegram_id', 'telegram_chat', 'telegram_username', 'telegram_verified_at', 'registered_at', 'reviewed_at', 'updated_at']
    return {**{key: user[key] for key in fields}, 'permissions': permissions(conn, identifier)}


def eligible(conn, row):
    return bool(row and row['status'] == 'active' and row['active'] and not row['linked_to'] and row['phone'] and
                row['telegram_id'] and row['telegram_verified_at'] and row['telegram_chat'] == row['telegram_id'] and
                'platform.full_access' in permissions(conn, row['id']))


def invalidate(conn, identifier):
    conn.execute('UPDATE users SET auth_epoch=auth_epoch+1 WHERE id=?', (identifier,))
    conn.execute('DELETE FROM sessions WHERE user_id=?', (identifier,))
    conn.execute('DELETE FROM phone_challenges WHERE user_id=?', (identifier,))


class AccessStore:
    def __init__(self, path, secret, *, send=None, clock=time.time, origin='http://127.0.0.1:8088'):
        self.path, self.secret, self.send, self.clock, self.origin = str(path), secret, send, clock, origin

    @contextmanager
    def transaction(self):
        with closing(sqlite3.connect(self.path, timeout=20, isolation_level=None)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute('PRAGMA foreign_keys=ON')
            conn.execute('BEGIN IMMEDIATE')
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def mac(self, identifier, code):
        return hmac.new(self.secret, f'kaiten-otp-v1:{identifier}:{code}'.encode(), hashlib.sha256).hexdigest()

    def limit(self, conn, key, maximum, seconds=900):
        key, now = sha(key), int(self.clock())
        row = conn.execute('SELECT * FROM phone_limits WHERE key=?', (key,)).fetchone()
        if not row or row['expires'] <= now:
            conn.execute('INSERT INTO phone_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,count=1', (key, now+seconds))
            return True
        conn.execute('UPDATE phone_limits SET count=count+1 WHERE key=?', (key,))
        return row['count'] < maximum

    def request_code(self, value, ip):
        phone = normalize_phone(value)
        if not phone:
            raise AccessError('Укажите номер телефона в формате +7XXXXXXXXXX.')
        delivery = None
        limited = False
        with self.transaction() as conn:
            now = int(self.clock())
            if not self.limit(conn, 'request-ip:'+ip, 20):
                limited = True
            else:
                key = sha('cooldown:'+phone)
                cooldown = conn.execute('SELECT next_at FROM phone_cooldowns WHERE key=?', (key,)).fetchone()
                if (not cooldown or cooldown[0] <= now) and self.limit(conn, 'request-phone:'+phone, 5):
                    conn.execute('INSERT INTO phone_cooldowns VALUES(?,?) ON CONFLICT(key) DO UPDATE SET next_at=excluded.next_at', (key, now+60))
                    conn.execute('DELETE FROM phone_challenges WHERE expires<=?', (now,))
                    user = conn.execute('SELECT * FROM users WHERE phone=? AND linked_to IS NULL', (phone,)).fetchone()
                    if eligible(conn, user) and self.send:
                        code, identifier = f'{secrets.randbelow(1000000):06d}', secrets.token_hex(32)
                        conn.execute('DELETE FROM phone_challenges WHERE user_id=?', (user['id'],))
                        conn.execute('INSERT INTO phone_challenges(id,user_id,phone,telegram_id,epoch,code_hash,expires) VALUES(?,?,?,?,?,?,?)',
                                     (identifier,user['id'],phone,user['telegram_id'],user['auth_epoch'],self.mac(identifier,code),now+600))
                        audit(conn, user['id'], user['id'], 'auth.code_requested', {'ipHash': sha(ip)})
                        delivery = {'chatId': user['telegram_id'], 'code': code, 'requestId': identifier, 'expiresAt': (now+600)*1000}
        if limited:
            raise AccessError('Слишком много запросов. Повторите через 15 минут.', 429)
        if delivery:
            sent = False
            try:
                self.send('code', delivery)
                sent = True
            except Exception:
                pass  # Same response even when an eligible user's Telegram cannot be reached.
            with self.transaction() as conn:
                if sent:
                    conn.execute('UPDATE phone_challenges SET delivered=1 WHERE id=?', (delivery['requestId'],))
                else:
                    conn.execute('DELETE FROM phone_challenges WHERE id=?', (delivery['requestId'],))
                    audit(conn, None, None, 'auth.delivery_failed')
        return dict(NEUTRAL)

    def verify(self, value, code, ip):
        phone = normalize_phone(value)
        result = None
        limited = False
        with self.transaction() as conn:
            now = int(self.clock())
            allowed_ip = self.limit(conn, 'verify-ip:'+ip, 40)
            allowed_phone = self.limit(conn, 'verify-phone:'+(phone or 'invalid'), 30)
            if not allowed_ip or not allowed_phone:
                limited = True
            else:
                row = conn.execute('SELECT * FROM phone_challenges WHERE phone=?', (phone,)).fetchone() if phone else None
                if row:
                    user = conn.execute('SELECT * FROM users WHERE id=?', (row['user_id'],)).fetchone()
                    valid = row['delivered'] and row['expires'] > now and row['attempts'] < 5 and eligible(conn,user) and row['epoch']==user['auth_epoch'] and row['telegram_id']==user['telegram_id'] and row['phone']==user['phone']
                    if not valid:
                        conn.execute('DELETE FROM phone_challenges WHERE id=?', (row['id'],))
                    else:
                        conn.execute('UPDATE phone_challenges SET attempts=attempts+1 WHERE id=?', (row['id'],))
                        if isinstance(code,str) and re.fullmatch(r'[0-9]{6}',code) and hmac.compare_digest(row['code_hash'],self.mac(row['id'],code)):
                            conn.execute('DELETE FROM phone_challenges WHERE user_id=?', (user['id'],))
                            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
                            conn.execute('DELETE FROM sessions WHERE expires<=?', (now,))
                            conn.execute('INSERT INTO sessions(token,user_id,csrf,expires,auth_epoch) VALUES(?,?,?,?,?)', (sha(token),user['id'],csrf,now+30*86400,user['auth_epoch']))
                            audit(conn,user['id'],user['id'],'auth.login',{'ipHash':sha(ip)})
                            result = {'token':token,'csrf':csrf,'user':public_user(conn,user['id'],True)}
                if not result:
                    audit(conn,None,None,'auth.failed',{'phoneHash':sha(phone or 'invalid'),'ipHash':sha(ip)})
        if limited:
            raise AccessError('Слишком много попыток. Повторите через 15 минут.',429)
        if not result:
            raise AccessError(INVALID,400)
        return result

    def change_access(self, actor, epoch, body):
        with self.transaction() as conn:
            owner=conn.execute('SELECT * FROM users WHERE id=?',(actor,)).fetchone()
            if not eligible(conn,owner) or owner['auth_epoch']!=epoch or 'admin.access.manage' not in permissions(conn,actor):
                raise AccessError('Нет права управлять доступом.',403)
            target=conn.execute('SELECT * FROM users WHERE id=?',(body.get('userId'),)).fetchone()
            if not target:
                raise AccessError('Пользователь не найден.',404)
            if target['linked_to']:
                raise AccessError('Эта карточка связана с сохранённым аккаунтом.',409)
            if type(body.get('version')) is not int or body['version']!=target['access_version']:
                raise AccessError('Карточка уже изменена. Обновите список.',409)
            if body.get('action')=='revoke-sessions':
                invalidate(conn,target['id'])
                conn.execute('UPDATE users SET access_version=access_version+1,updated_at=? WHERE id=?',(stamp(),target['id']))
                audit(conn,actor,target['id'],'sessions.revoked')
                return public_user(conn,target['id'],True)
            state,rights,role=body.get('status'),body.get('permissions'),body.get('role',target['role'])
            if state not in ('pending','active','blocked') or role not in ('admin','employee') or not isinstance(rights,list) or len(rights)>100 or any(not isinstance(p,str) or p not in CATALOG for p in rights) or len(set(rights))!=len(rights):
                raise AccessError('Проверьте статус, роль и права.')
            if target['status']=='active' and state=='pending':
                raise AccessError('Для закрытия доступа используйте блокировку.')
            before=public_user(conn,target['id'],True)
            keep_admin=state=='active' and all(p in rights for p in ('platform.full_access','admin.access.manage'))
            if before['status']=='active' and all(p in before['permissions'] for p in ('platform.full_access','admin.access.manage')) and not keep_admin:
                others=conn.execute("SELECT * FROM users WHERE id!=? AND linked_to IS NULL",(target['id'],)).fetchall()
                if not any(eligible(conn,u) and 'admin.access.manage' in permissions(conn,u['id']) for u in others):
                    raise AccessError('Нельзя закрыть доступ последнему администратору.',409)
            conn.execute('UPDATE users SET role=?,status=?,active=?,reviewed_at=?,updated_at=?,access_version=access_version+1 WHERE id=?', (role,state,int(state=='active'),stamp() if state!='pending' else target['reviewed_at'],stamp(),target['id']))
            conn.execute('DELETE FROM access_permissions WHERE user_id=?',(target['id'],))
            for p in rights:
                conn.execute('INSERT INTO access_permissions VALUES(?,?)',(target['id'],p))
            invalidate(conn,target['id'])
            after=public_user(conn,target['id'],True)
            audit(conn,actor,target['id'],'access.changed',{'before':{'status':before['status'],'role':before['role'],'permissions':before['permissions']},'after':{'status':state,'role':role,'permissions':rights}})
            self.enqueue(conn,target['id'],'access',target['id'])
            return after

    def enqueue(self,conn,user,kind,subject):
        conn.execute('INSERT INTO access_outbox(id,user_id,subject_id,kind,created_at) VALUES(?,?,?,?,?)',(str(uuid.uuid4()),user,subject,kind,stamp()))

    def menu(self,user):
        if not user:
            return {'text':'Для регистрации в Kaiten отправьте свой контакт кнопкой Telegram.','reply_markup':{'keyboard':[[{'text':'Отправить мой номер','request_contact':True}]],'resize_keyboard':True,'one_time_keyboard':True}}
        if user['status']=='pending':
            return {'text':'Заявка Kaiten отправлена. Дождитесь одобрения руководителя.','reply_markup':{'remove_keyboard':True}}
        if user['status']!='active' or user['linked_to']:
            return {'text':'Доступ в Kaiten закрыт. Обратитесь к руководителю.','reply_markup':{'remove_keyboard':True}}
        buttons=[]
        if 'platform.full_access' in user['permissions']:
            buttons.append([{'text':'Открыть Kaiten','url':self.origin}])
            if 'admin.access.manage' in user['permissions']:
                buttons.append([{'text':'Доступы Kaiten','url':self.origin+'/?view=team'}])
        return {'text':'Ваш доступ в Kaiten одобрен.\n'+ '\n'.join('• '+CATALOG[p] for p in user['permissions'] if p in CATALOG),'reply_markup':{'inline_keyboard':buttons} if buttons else {'remove_keyboard':True}}

    def registration(self,message,event_id):
        m=message if isinstance(message,dict) else {}
        sender,chat=m.get('from',{}),m.get('chat',{})
        identifier=sender.get('id')
        if type(identifier) is not int or identifier<=0 or identifier>2**53-1 or sender.get('is_bot') or chat.get('type')!='private' or chat.get('id')!=identifier:
            raise AccessError('Регистрация доступна только в личном чате.',403)
        tg=str(identifier)
        if not isinstance(event_id,str) or not re.fullmatch(r'[0-9]{1,16}:[0-9]{1,20}',event_id) or not event_id.startswith(tg+':') or str(m.get('message_id'))!=event_id.split(':')[1]:
            raise AccessError('Некорректное сообщение.')
        username=sender.get('username')
        username=username if isinstance(username,str) and re.fullmatch(r'[A-Za-z0-9_]{1,32}',username) else None
        with self.transaction() as conn:
            old=conn.execute('SELECT response FROM registration_events WHERE event_id=?',(event_id,)).fetchone()
            if old:
                return json.loads(old[0])
            now=int(self.clock())
            conn.execute('DELETE FROM registration_drafts WHERE expires<=?',(now,))
            bound=conn.execute('SELECT * FROM users WHERE telegram_id=? AND linked_to IS NULL',(tg,)).fetchone()
            contact=m.get('contact')
            if contact is not None:
                phone=normalize_phone(contact.get('phone_number')) if isinstance(contact,dict) else None
                if not phone or type(contact.get('user_id')) is not int or contact['user_id']!=identifier:
                    result=self.menu(None);result['text']='Отправьте собственный российский номер через кнопку Telegram.'
                elif bound:
                    result=self.menu(public_user(conn,bound['id'],True)) if bound['phone']==phone else {'text':'Telegram уже связан с аккаунтом. Смена номера — через руководителя.'}
                else:
                    target=conn.execute('SELECT * FROM users WHERE phone=? AND linked_to IS NULL',(phone,)).fetchone()
                    if target and target['telegram_id'] and target['telegram_id']!=tg:
                        result={'text':'Номер уже связан с другим Telegram. Обратитесь к руководителю.'}
                    elif target:  # Explicitly assigned by an administrator, never matched by name.
                        conn.execute('UPDATE users SET telegram_id=?,telegram_chat=?,telegram_username=?,telegram_verified_at=?,updated_at=?,access_version=access_version+1 WHERE id=?',(tg,tg,username,now,stamp(),target['id']))
                        invalidate(conn,target['id'])
                        audit(conn,target['id'],target['id'],'telegram.contact_verified')
                        result=self.menu(public_user(conn,target['id'],True))
                    elif conn.execute('SELECT 1 FROM registration_drafts WHERE phone=? AND telegram_id!=?',(phone,tg)).fetchone():
                        result={'text':'Этот номер уже ожидает регистрации. Обратитесь к руководителю.'}
                    else:
                        conn.execute('INSERT INTO registration_drafts VALUES(?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET phone=excluded.phone,username=excluded.username,verified_at=excluded.verified_at,expires=excluded.expires',(tg,phone,username,now,now+86400))
                        result={'text':'Номер подтверждён. Напишите ваши фамилию, имя и отчество одним сообщением.','reply_markup':{'remove_keyboard':True}}
            elif bound:
                conn.execute('UPDATE users SET telegram_username=? WHERE id=?',(username,bound['id']))
                result=self.menu(public_user(conn,bound['id'],True))
            else:
                draft=conn.execute('SELECT * FROM registration_drafts WHERE telegram_id=?',(tg,)).fetchone()
                name=' '.join(m.get('text','').split()) if isinstance(m.get('text'),str) else ''
                if not draft or name.startswith('/'):
                    result=self.menu(None)
                elif not 3<=len(name)<=80 or len(name.split())<2 or re.search(r'[\x00-\x1f\x7f<>]',name):
                    result={'text':'Укажите фамилию, имя и отчество, если оно есть (до 80 символов).'}
                else:
                    user_id=uuid.uuid4().hex
                    conn.execute("INSERT INTO users(id,name,login,password,role,active,status,phone,telegram_id,telegram_chat,telegram_username,telegram_verified_at,created_at,registered_at,updated_at) VALUES(?,?,?,?,'employee',0,'pending',?,?,?,?,?,?,?,?)",(user_id,name,'phone-only:'+user_id,'!disabled',draft['phone'],tg,tg,username,draft['verified_at'],stamp(),stamp(),stamp()))
                    conn.execute('DELETE FROM registration_drafts WHERE telegram_id=?',(tg,))
                    audit(conn,user_id,user_id,'registration.pending')
                    for admin in conn.execute("SELECT * FROM users WHERE status='active' AND linked_to IS NULL").fetchall():
                        if admin['active'] and all(p in permissions(conn,admin['id']) for p in ('platform.full_access','admin.access.manage')):
                            self.enqueue(conn,admin['id'],'registration',user_id)
                    result=self.menu(public_user(conn,user_id,True))
            conn.execute('INSERT INTO registration_events VALUES(?,?,?)',(event_id,json.dumps(result,ensure_ascii=False),stamp()))
            return result

    def bind_existing(self,target_id,telegram_id,phone,actor='server-owner'):
        """Local operator action, only after a Telegram-owned contact has been verified."""
        phone=normalize_phone(phone)
        with self.transaction() as conn:
            target=conn.execute('SELECT * FROM users WHERE id=?',(target_id,)).fetchone()
            if not target or target['phone'] or target['telegram_id'] or target['linked_to'] or not phone:
                raise AccessError('Нужен существующий аккаунт без привязанной личности.',409)
            tg=str(telegram_id)
            draft=conn.execute('SELECT * FROM registration_drafts WHERE telegram_id=? AND phone=? AND expires>?',(tg,phone,int(self.clock()))).fetchone()
            pending=conn.execute("SELECT * FROM users WHERE telegram_id=? AND phone=? AND status='pending' AND linked_to IS NULL",(tg,phone)).fetchone()
            if not draft and not pending:
                raise AccessError('Нет подтверждённого контакта или ожидающей заявки.',409)
            source=dict(draft or pending)
            if pending:
                if conn.execute('SELECT 1 FROM projects WHERE owner_id=?',(pending['id'],)).fetchone() or conn.execute('SELECT 1 FROM tasks WHERE assignee_id=? OR created_by=?',(pending['id'],pending['id'])).fetchone():
                    raise AccessError('У заявки уже есть рабочие данные. Автоматическая привязка запрещена.',409)
                conn.execute("UPDATE users SET linked_to=?,status='blocked',active=0,updated_at=?,access_version=access_version+1 WHERE id=?",(target_id,stamp(),pending['id']))
                invalidate(conn,pending['id'])
            username=source.get('username',source.get('telegram_username'))
            verified=source.get('verified_at',source.get('telegram_verified_at'))
            conn.execute('UPDATE users SET phone=?,telegram_id=?,telegram_chat=?,telegram_username=?,telegram_verified_at=?,updated_at=?,access_version=access_version+1 WHERE id=?',(phone,tg,tg,username,verified,stamp(),target_id))
            conn.execute('DELETE FROM registration_drafts WHERE telegram_id=?',(tg,))
            invalidate(conn,target_id)
            audit(conn,actor,target_id,'identity.existing_bound',{'sourceId':pending['id'] if pending else None,'phone':phone,'telegramId':tg})
            return public_user(conn,target_id,True)

    def flush_notifications(self):
        if not self.send:
            return
        with self.transaction() as conn:
            items=[dict(r) for r in conn.execute('SELECT * FROM access_outbox WHERE sent=0 AND next_at<=? ORDER BY created_at LIMIT 20',(int(self.clock()),))]
        for item in items:
            with self.transaction() as conn:
                user=public_user(conn,item['user_id'],True)
                subject=public_user(conn,item['subject_id'],True) if item['subject_id'] else None
                row=conn.execute('SELECT * FROM users WHERE id=?',(item['user_id'],)).fetchone()
                if item['kind']=='registration' and (not user or user['status']!='active' or user['linked_to'] or not all(p in user['permissions'] for p in ('platform.full_access','admin.access.manage'))):
                    conn.execute('UPDATE access_outbox SET sent=2 WHERE id=?',(item['id'],));continue
                if not user or not user['telegram_verified_at'] or not user['telegram_id']:
                    continue
                content=self.menu(user) if item['kind']=='access' else {'text':f"Новая заявка Kaiten\n{subject['name']}\n{subject['phone']}\nОткройте раздел «Доступы».",'reply_markup':{'inline_keyboard':[[{'text':'Рассмотреть заявку','url':self.origin+'/?view=team'}]]}}
            try:
                self.send('notify',{'chatId':user['telegram_id'],'requestId':item['id'],**content})
                with self.transaction() as conn:
                    conn.execute('UPDATE access_outbox SET sent=1 WHERE id=?',(item['id'],))
            except Exception:
                with self.transaction() as conn:
                    conn.execute('UPDATE access_outbox SET attempts=attempts+1,next_at=? WHERE id=?',(int(self.clock())+min(3600,30*2**min(item['attempts'],7)),item['id']))
