import os
import json
import re
import time
import uuid
import hashlib
import secrets
import sqlite3
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

from flask import Flask, request, g, jsonify, send_file, abort
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix
from access import AccessStore, AccessError, CATALOG, migrate, load_secret, public_user, permissions, eligible, audit
from telegram_bridge import BridgeClient, authenticate as authenticate_bridge

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo('Europe/Moscow')
PRIORITIES = ('4', '20', '80', 'backlog')
STATUSES = ('todo', 'doing', 'done')


def uid():
    return uuid.uuid4().hex


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def today():
    return datetime.now(TZ).date().isoformat()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_login(name):
    return unicodedata.normalize('NFKC', name).strip().casefold()


def create_app(config=None):
    app = Flask(__name__, static_folder='static', static_url_path='/static')
    app.json.sort_keys=False
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    app.config.update(DATA_DIR=os.environ.get('DATA_DIR', str(ROOT / 'data')),
                      PUBLIC_URL=os.environ.get('PUBLIC_URL', 'http://127.0.0.1:8087').rstrip('/'),
                      COOKIE_SECURE=os.environ.get('COOKIE_SECURE', '0') == '1',
                      MAX_CONTENT_LENGTH=26 * 1024 * 1024,
                      TELEGRAM_BOT_USERNAME=os.environ.get('TELEGRAM_BOT_USERNAME', ''),
                      TELEGRAM_CONFIGURED=False,
                      KAITEN_BOT_ORIGIN=os.environ.get('KAITEN_BOT_ORIGIN',''),
                      KAITEN_BRIDGE_KEY=os.environ.get('KAITEN_BRIDGE_KEY',''),
                      KAITEN_SERVICE_ID=os.environ.get('KAITEN_SERVICE_ID','kaiten-test'),
                      KAITEN_BOT_USERNAME=os.environ.get('KAITEN_BOT_USERNAME',''))
    if config:
        app.config.update(config)
    data = Path(app.config['DATA_DIR'])
    data.mkdir(parents=True, exist_ok=True)
    (data / 'uploads').mkdir(exist_ok=True)
    app.config['DB_PATH'] = str(data / 'focus.sqlite3')
    with closing(sqlite3.connect(app.config['DB_PATH'], timeout=30)) as db, db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript((ROOT / 'schema.sql').read_text())
        db.execute('BEGIN IMMEDIATE')
        for table in ('users', 'invites'):
            columns = {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
            if 'email' in columns:
                db.execute(f'ALTER TABLE {table} RENAME COLUMN email TO login')
        if 'name' not in {row[1] for row in db.execute('PRAGMA table_info(invites)')}:
            db.execute("ALTER TABLE invites ADD COLUMN name TEXT NOT NULL DEFAULT ''")
        if not db.execute("SELECT 1 FROM settings WHERE key='auth_names_v1'").fetchone():
            existing = db.execute('SELECT id,name FROM users ORDER BY created_at,id').fetchall()
            for identifier, name in existing:
                db.execute('UPDATE users SET login=? WHERE id=?', ('migration:' + identifier, identifier))
            used = set()
            for identifier, name in existing:
                login = '_'.join(normalize_login(name).split())
                if login in used:
                    login += ' ' + identifier[:8]
                used.add(login)
                db.execute('UPDATE users SET login=? WHERE id=?', (login, identifier))
            db.execute("UPDATE invites SET used=1 WHERE name=''")
            db.execute("INSERT INTO settings VALUES('auth_names_v1','1')")

    with closing(sqlite3.connect(app.config['DB_PATH'], timeout=30)) as migration_db:
        migrate(migration_db)
    store=AccessStore(app.config['DB_PATH'],load_secret(data),origin=app.config['PUBLIC_URL'],clock=app.config.get('AUTH_CLOCK',time.time))
    if app.config.get('AUTH_SEND'):
        if not app.config.get('TESTING'):
            raise RuntimeError('Custom code delivery is allowed only in tests')
        store.send=app.config['AUTH_SEND']
    elif app.config['KAITEN_BOT_ORIGIN'] and app.config['KAITEN_BRIDGE_KEY']:
        bridge=BridgeClient(app.config['KAITEN_BOT_ORIGIN'],app.config['KAITEN_BRIDGE_KEY'],app.config['KAITEN_SERVICE_ID'],app.config['PUBLIC_URL'])
        store.send=bridge.send
    app.extensions['access_store']=store
    if urlsplit(app.config['PUBLIC_URL']).scheme=='https':
        app.config['COOKIE_SECURE']=True

    def db():
        if 'db' not in g:
            g.db = sqlite3.connect(app.config['DB_PATH'], timeout=15)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys=ON')
        return g.db

    def q(sql, args=()):
        return db().execute(sql, args)

    def one(sql, args=()):
        return q(sql, args).fetchone()

    def rows(sql, args=()):
        return [dict(x) for x in q(sql, args).fetchall()]

    def fail(message, status=400):
        abort(status, description=message)

    def body():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            fail('Ожидается JSON-объект')
        return value

    def text(value, name, limit=500, required=True):
        if not isinstance(value, str):
            fail(f'Некорректное поле: {name}')
        value = value.strip()
        if (required and not value) or len(value) > limit:
            fail(f'{name}: от 1 до {limit} символов' if required else f'{name}: не более {limit} символов')
        return value

    def user_public(user):
        return public_user(db(), user['id'], True)

    def has(permission):
        return permission in g.permissions

    def all_projects():
        return g.user['role']=='admin' and has('company.tasks.read')

    def require(permission):
        if not has(permission):
            fail('Нет права на это действие',403)

    def get_project(pid):
        if not isinstance(pid, str):
            fail('Укажите проект')
        p = one('SELECT * FROM projects WHERE id=?', (pid,))
        if not p or (not all_projects() and not one(
                'SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (pid, g.user['id']))):
            fail('Проект не найден', 404)
        return p

    def project_owner(p):
        if g.user['role'] != 'admin' and p['owner_id'] != g.user['id']:
            fail('Изменять проект может его создатель или руководитель', 403)

    def get_task(tid, edit=False):
        t = one('SELECT * FROM tasks WHERE id=?', (tid,))
        if not t:
            fail('Задача не найдена', 404)
        p = get_project(t['project_id'])
        if edit and not (g.user['role'] == 'admin' or g.user['id'] in
                         (t['created_by'], t['assignee_id'], p['owner_id']) or
                         one('SELECT 1 FROM task_members WHERE task_id=? AND user_id=?', (tid, g.user['id']))):
            fail('Редактировать задачу могут автор, исполнитель, участники и владелец проекта', 403)
        return t

    def member(pid, user_id):
        if not isinstance(user_id, str) or not one(
                'SELECT 1 FROM project_members m JOIN users u ON u.id=m.user_id '
                'WHERE m.project_id=? AND m.user_id=? AND u.active=1', (pid, user_id)):
            fail('Исполнитель и участники должны состоять в проекте')

    def activity(pid, tid, message):
        q('INSERT INTO activity(project_id,task_id,user_id,text,created_at) VALUES(?,?,?,?,?)',
          (pid, tid, g.user['id'], message, now()))

    def notify(tid, message, extra=()):
        t = one('SELECT * FROM tasks WHERE id=?', (tid,))
        recipients = {t['assignee_id']} | {r['user_id'] for r in q(
            'SELECT user_id FROM task_members WHERE task_id=?', (tid,))} | set(extra)
        for recipient in recipients - {g.user['id']}:
            q('INSERT INTO outbox(user_id,text,created_at,task_id) VALUES(?,?,?,?)',
              (recipient, f"{g.user['name']}: {message}\n{t['title']}\n"
               f"{app.config['PUBLIC_URL']}/?task={tid}", now(),tid))

    def task_json(t):
        result = dict(t)
        result['participants'] = [r['user_id'] for r in q('SELECT user_id FROM task_members WHERE task_id=?', (t['id'],))]
        result['files_count'] = one('SELECT COUNT(*) n FROM files WHERE task_id=?', (t['id'],))['n']
        result['comments_count'] = one('SELECT COUNT(*) n FROM comments WHERE task_id=?', (t['id'],))['n']
        return result

    def load_identity():
        token=request.cookies.get('kaiten_session','')
        session=one('SELECT * FROM sessions WHERE token=? AND expires>?',(digest(token),int(store.clock())))
        user=one('SELECT * FROM users WHERE id=?',(session['user_id'],)) if session else None
        if not session or not eligible(db(),user) or session['auth_epoch']!=user['auth_epoch']:
            fail('Войдите по номеру телефона',401)
        g.user,g.session,g.permissions=user,session,permissions(db(),user['id'])
        if request.method not in ('GET','HEAD','OPTIONS') and not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),session['csrf']):
            fail('Обновите страницу и повторите действие',403)

    def authorize_route():
        path,method=request.path,request.method
        required=None
        if path.startswith('/api/access'):
            required='admin.access.manage'
        elif path.startswith('/api/projects'):
            required='projects.read' if method=='GET' else 'projects.create' if method=='POST' else 'projects.manage'
        elif path.startswith('/api/files'):
            required='files.read' if method=='GET' else 'files.upload'
        elif path.startswith('/api/tasks'):
            required='comments.create' if path.endswith('/comments') else 'files.upload' if path.endswith('/files') else 'tasks.read' if method=='GET' else 'tasks.create' if method=='POST' else 'tasks.edit'
        if path.startswith(('/api/tasks','/api/files')):
            require('projects.read')
            require('tasks.read')
        if required:
            require(required)

    @app.before_request
    def authenticate():
        if not request.path.startswith('/api/'):
            return
        if request.path.startswith('/api/auth/'):
            request.max_content_length=4096
        elif request.is_json:
            request.max_content_length=256*1024
        if request.path.startswith('/api/telegram-bridge/'):
            return  # This route authenticates its signed message separately.
        if request.method not in ('GET','HEAD','OPTIONS') and request.headers.get('Origin')!=app.config['PUBLIC_URL']:
            fail('Недопустимый источник запроса',403)
        if request.path in ('/api/health','/api/auth/state','/api/auth/request-code','/api/auth/verify'):
            return
        load_identity()
        authorize_route()
        if request.method not in ('GET','HEAD','OPTIONS') and not request.path.startswith('/api/access/'):
            # Receive/spool the network body without holding the database write lock.
            # A revocation may commit while the client is still uploading.
            if request.path.endswith('/files') and request.method=='POST':
                request.files
            elif request.is_json:
                request.get_json(silent=True)
            db().execute('BEGIN IMMEDIATE')
            # Recheck the same session, epoch and permissions in the mutation transaction.
            load_identity()
            authorize_route()
        # AccessStore performs the same fresh actor check in its own write transaction.

    @app.after_request
    def finish(response):
        if 'db' in g:
            if response.status_code < 400:
                g.db.commit()
            else:
                g.db.rollback()
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.teardown_appcontext
    def close(error=None):
        if 'db' in g:
            g.db.close()

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith('/api/'):
            message = 'Файл слишком большой. Максимум — 25 МБ.' if error.code == 413 else error.description
            return jsonify(error=message), error.code
        return error

    @app.errorhandler(AccessError)
    def access_error(error):
        return jsonify(error=str(error)),error.status

    @app.errorhandler(sqlite3.IntegrityError)
    def integrity_error(error):
        return jsonify(error='Данные изменились или такая запись уже существует. Обновите страницу.'), 409

    @app.get('/')
    def index():
        return app.send_static_file('index.html')

    @app.get('/api/health')
    def health():
        q('SELECT 1')
        return jsonify(ok=True)

    @app.get('/api/auth/state')
    def auth_state():
        username=app.config['KAITEN_BOT_USERNAME']
        return jsonify(mode='phone-telegram',configured=bool(store.send),bot_url=(f"https://t.me/{username}?start={app.config['KAITEN_SERVICE_ID']}" if re.fullmatch(r'[A-Za-z0-9_]{5,32}',username) else None))

    @app.post('/api/auth/request-code')
    def request_code():
        return jsonify(store.request_code(body().get('phone'),request.remote_addr or 'unknown'))

    @app.post('/api/auth/verify')
    def verify_code():
        b=body()
        result=store.verify(b.get('phone'),b.get('code'),request.remote_addr or 'unknown')
        response=jsonify(user=result['user'],csrf=result['csrf'])
        response.set_cookie('kaiten_session',result['token'],httponly=True,secure=app.config['COOKIE_SECURE'],samesite='Strict',max_age=30*86400,path='/')
        response.delete_cookie('focus_session',path='/')
        return response

    @app.get('/api/auth/me')
    @app.get('/api/me')
    def me():
        return jsonify(user=user_public(g.user),csrf=g.session['csrf'])

    @app.post('/api/auth/logout')
    def logout():
        q('DELETE FROM sessions WHERE token=?',(g.session['token'],))
        audit(db(),g.user['id'],g.user['id'],'auth.logout')
        response=jsonify(ok=True)
        response.delete_cookie('kaiten_session',path='/',httponly=True,secure=app.config['COOKIE_SECURE'],samesite='Strict')
        return response

    @app.post('/api/telegram-bridge/message')
    def telegram_registration():
        if request.content_length is None or request.content_length>8192:
            fail('Сообщение слишком большое',413)
        raw=request.get_data()
        try:
            authenticate_bridge(store,app.config['KAITEN_BRIDGE_KEY'],app.config['KAITEN_SERVICE_ID'],request.path,raw,request.headers)
        except ValueError:
            fail('Интеграция с ботом не настроена',503)
        b=body()
        result=store.registration(b.get('message'),b.get('eventId'))
        return jsonify(result)

    @app.get('/api/access')
    def access_list():
        users=[public_user(db(),r['id'],True) for r in q('SELECT id FROM users ORDER BY CASE status WHEN \'pending\' THEN 0 WHEN \'active\' THEN 1 ELSE 2 END,name')]
        return jsonify(users=users,catalog=CATALOG)

    @app.post('/api/access/update')
    def access_update():
        return jsonify(user=store.change_access(g.user['id'],g.session['auth_epoch'],body()))

    @app.get('/api/access/audit')
    def access_audit():
        events=rows('SELECT a.*,u.name actor_name,s.name subject_name FROM access_audit a LEFT JOIN users u ON a.actor_id=u.id LEFT JOIN users s ON a.subject_id=s.id ORDER BY a.id DESC LIMIT 200')
        for event in events:
            event['detail']=json.loads(event['detail'])
        return jsonify(events=events)

    @app.get('/api/workspace')
    def workspace():
        projects = rows('SELECT p.*,u.name owner_name FROM projects p JOIN users u ON p.owner_id=u.id '
                        'WHERE ?=\'admin\' OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?) '
                        'ORDER BY p.created_at', ('admin' if all_projects() else 'employee', g.user['id']))
        if not has('projects.read'):
            projects=[]
        ids = [p['id'] for p in projects]
        for p in projects:
            p['members'] = [r['user_id'] for r in q('SELECT user_id FROM project_members WHERE project_id=?', (p['id'],))]
        tasks = []
        events = []
        if ids and has('tasks.read'):
            placeholders = ','.join('?' for _ in ids)
            tasks = [task_json(t) for t in q(f'SELECT * FROM tasks WHERE project_id IN ({placeholders}) ORDER BY position,created_at', ids)]
            events = rows(f'SELECT a.*,u.name user_name FROM activity a LEFT JOIN users u ON a.user_id=u.id '
                          f'WHERE project_id IN ({placeholders}) ORDER BY a.id DESC LIMIT 40', ids)
        return jsonify(projects=projects, tasks=tasks,
                       users=rows('SELECT id,name,role,active,status FROM users WHERE linked_to IS NULL AND status!=\'pending\' ORDER BY name'),
                       activity=events, today=today())

    @app.post('/api/projects')
    def create_project():
        b = body()
        title = text(b.get('title', ''), 'Название проекта', 100)
        description = text(b.get('description', ''), 'Описание', 5000, False)
        color = b.get('color', '#7274f5')
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            fail('Некорректный цвет')
        pid = uid()
        q('INSERT INTO projects VALUES(?,?,?,?,?,?)', (pid, title, description, color, g.user['id'], now()))
        q('INSERT INTO project_members VALUES(?,?)', (pid, g.user['id']))
        activity(pid, None, f'Создал(а) проект «{title}»')
        return jsonify(id=pid), 201

    @app.patch('/api/projects/<pid>')
    def update_project(pid):
        p = get_project(pid)
        project_owner(p)
        b = body()
        title = text(b.get('title', p['title']), 'Название проекта', 100)
        description = text(b.get('description', p['description']), 'Описание', 5000, False)
        q('UPDATE projects SET title=?,description=? WHERE id=?', (title, description, pid))
        if 'members' in b:
            members = b['members']
            if not isinstance(members, list) or not all(isinstance(x, str) for x in members) or len(members) > 1000:
                fail('Некорректный список участников')
            members = set(members) | {p['owner_id']}
            for user_id in members:
                if not one('SELECT 1 FROM users WHERE id=? AND active=1', (user_id,)):
                    fail('Участник не найден')
            removed = {r['user_id'] for r in q('SELECT user_id FROM project_members WHERE project_id=?', (pid,))} - members
            for user_id in removed:
                if one('SELECT 1 FROM tasks WHERE project_id=? AND assignee_id=?', (pid, user_id)):
                    fail('Сначала переназначьте задачи удаляемого участника')
                q('DELETE FROM task_members WHERE user_id=? AND task_id IN (SELECT id FROM tasks WHERE project_id=?)', (user_id, pid))
            q('DELETE FROM project_members WHERE project_id=?', (pid,))
            for user_id in members:
                q('INSERT INTO project_members VALUES(?,?)', (pid, user_id))
        activity(pid, None, f'Обновил(а) проект «{title}»')
        return jsonify(ok=True)

    def purge_files(file_rows):
        for f in file_rows:
            (data / 'uploads' / f['id']).unlink(missing_ok=True)

    @app.delete('/api/projects/<pid>')
    def delete_project(pid):
        p = get_project(pid)
        project_owner(p)
        files = rows('SELECT f.id FROM files f JOIN tasks t ON f.task_id=t.id WHERE t.project_id=?', (pid,))
        q('DELETE FROM projects WHERE id=?', (pid,))
        db().commit()
        purge_files(files)
        return jsonify(ok=True)

    def validate_task(b, current=None):
        current = dict(current) if current else {}
        result = {k: b.get(k, current.get(k, default)) for k, default in
                  [('title', ''), ('description', ''), ('priority', 'backlog'), ('status', 'todo'),
                   ('due_date', None), ('due_time', None), ('assignee_id', g.user['id'])]}
        result['title'] = text(result['title'], 'Название задачи', 300)
        result['description'] = text(result['description'], 'Описание', 20000, False)
        if result['priority'] not in PRIORITIES or result['status'] not in STATUSES:
            fail('Некорректная важность или статус')
        for key, fmt in [('due_date', '%Y-%m-%d'), ('due_time', '%H:%M')]:
            value = result[key]
            if value:
                try:
                    if not isinstance(value, str) or datetime.strptime(value, fmt).strftime(fmt) != value:
                        fail('Некорректная дата или время')
                except (ValueError, TypeError):
                    fail('Некорректная дата или время')
            else:
                result[key] = None
        if not result['due_date']:
            result['due_time'] = None
        if not (g.user['role']=='admin' and has('tasks.assign')) and result['assignee_id'] != g.user['id'] and result['assignee_id'] != current.get('assignee_id'):
            fail('Назначать задачи другим сотрудникам может руководитель', 403)
        return result

    @app.post('/api/tasks')
    def create_task():
        b = body()
        pid = b.get('project_id')
        get_project(pid)
        parent_id = b.get('parent_id') or None
        if parent_id:
            parent = get_task(parent_id, True)
            if parent['project_id'] != pid:
                fail('Подзадача должна быть в том же проекте')
            depth = 1
            cursor = parent
            while cursor['parent_id']:
                depth += 1
                cursor = get_task(cursor['parent_id'])
            if depth >= 10:
                fail('Максимум 10 уровней вложенности')
            if parent['status'] == 'done':
                fail('Сначала верните родительскую задачу в работу')
        v = validate_task(b)
        member(pid, v['assignee_id'])
        tid = uid()
        position = one('SELECT COALESCE(MAX(position),0)+1 n FROM tasks WHERE project_id=?', (pid,))['n']
        q('INSERT INTO tasks(id,project_id,parent_id,title,description,priority,status,due_date,due_time,assignee_id,'
          'created_by,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          (tid, pid, parent_id, v['title'], v['description'], v['priority'], v['status'], v['due_date'], v['due_time'],
           v['assignee_id'], g.user['id'], position, now(), now()))
        participants = b.get('participants', [])
        if not isinstance(participants, list) or not all(isinstance(x, str) for x in participants) or len(participants) > 1000:
            fail('Некорректные участники')
        for user_id in set(participants):
            member(pid, user_id)
            q('INSERT INTO task_members VALUES(?,?)', (tid, user_id))
        activity(pid, tid, f'Создал(а) задачу «{v["title"]}»')
        notify(tid, 'Новая задача')
        return jsonify(task_json(get_task(tid))), 201

    @app.get('/api/tasks/<tid>')
    def task_detail(tid):
        t = get_task(tid)
        result = task_json(t)
        result['comments'] = rows('SELECT c.*,u.name user_name FROM comments c JOIN users u ON c.user_id=u.id '
                                  'WHERE task_id=? ORDER BY created_at,id', (tid,))
        result['files'] = rows('SELECT f.*,u.name user_name FROM files f JOIN users u ON f.user_id=u.id '
                               'WHERE task_id=? ORDER BY created_at', (tid,))
        if not has('files.read'):
            result['files']=[]
        result['activity'] = rows('SELECT a.*,u.name user_name FROM activity a LEFT JOIN users u ON a.user_id=u.id '
                                  'WHERE task_id=? ORDER BY a.id DESC LIMIT 30', (tid,))
        return jsonify(result)

    @app.patch('/api/tasks/<tid>')
    def update_task(tid):
        b = body()
        t = get_task(tid, True)
        if b.get('version') != t['version']:
            fail('Задача уже изменена коллегой. Обновите её и повторите действие.', 409)
        v = validate_task(b, t)
        member(t['project_id'], v['assignee_id'])
        if v['status'] == 'done':
            if one('WITH RECURSIVE children AS (SELECT id,status FROM tasks WHERE parent_id=? UNION ALL '
                   'SELECT t.id,t.status FROM tasks t JOIN children c ON t.parent_id=c.id) '
                   'SELECT 1 FROM children WHERE status!=\'done\' LIMIT 1', (tid,)):
                fail('Сначала завершите все подзадачи', 409)
        elif t['status'] == 'done':
            # Reopening a child also reopens completed ancestors, keeping progress consistent.
            q('WITH RECURSIVE parents AS (SELECT parent_id id FROM tasks WHERE id=? UNION ALL '
              'SELECT t.parent_id FROM tasks t JOIN parents p ON t.id=p.id WHERE t.parent_id IS NOT NULL) '
              'UPDATE tasks SET status=\'todo\',version=version+1,updated_at=? WHERE id IN (SELECT id FROM parents) AND status=\'done\'',
              (tid, now()))
        q('UPDATE tasks SET title=?,description=?,priority=?,status=?,due_date=?,due_time=?,assignee_id=?,version=version+1,updated_at=? WHERE id=?',
          (v['title'], v['description'], v['priority'], v['status'], v['due_date'], v['due_time'], v['assignee_id'], now(), tid))
        if 'participants' in b:
            participants = b['participants']
            if not isinstance(participants, list) or not all(isinstance(x, str) for x in participants) or len(participants) > 1000:
                fail('Некорректные участники')
            q('DELETE FROM task_members WHERE task_id=?', (tid,))
            for user_id in set(participants):
                member(t['project_id'], user_id)
                q('INSERT INTO task_members VALUES(?,?)', (tid, user_id))
        activity(t['project_id'], tid, f'Обновил(а) задачу «{v["title"]}»')
        notify(tid, 'Задача обновлена')
        return jsonify(task_json(get_task(tid)))

    @app.delete('/api/tasks/<tid>')
    def delete_task(tid):
        t = get_task(tid, True)
        ids = [r['id'] for r in q('WITH RECURSIVE tree AS (SELECT id FROM tasks WHERE id=? UNION ALL '
                                 'SELECT t.id FROM tasks t JOIN tree x ON t.parent_id=x.id) SELECT id FROM tree', (tid,))]
        placeholders = ','.join('?' for _ in ids)
        files = rows(f'SELECT id FROM files WHERE task_id IN ({placeholders})', ids)
        activity(t['project_id'], tid, f'Удалил(а) задачу «{t["title"]}»')
        q('DELETE FROM tasks WHERE id=?', (tid,))
        db().commit()
        purge_files(files)
        return jsonify(ok=True)

    @app.post('/api/tasks/<tid>/comments')
    def add_comment(tid):
        t = get_task(tid)
        content = text(body().get('body', ''), 'Комментарий', 10000)
        q('INSERT INTO comments VALUES(?,?,?,?,?)', (uid(), tid, g.user['id'], content, now()))
        activity(t['project_id'], tid, 'Добавил(а) комментарий')
        notify(tid, 'Комментарий: ' + content[:1500])
        return jsonify(ok=True), 201

    @app.post('/api/tasks/<tid>/files')
    def upload(tid):
        t = get_task(tid, True)
        uploaded = request.files.get('file')
        if not uploaded or not uploaded.filename:
            fail('Выберите файл')
        name = uploaded.filename.replace('\\', '/').split('/')[-1]
        name = ''.join(ch for ch in name if ord(ch) >= 32)[:200]
        allowed = {'png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z', 'odt', 'ods'}
        if name.rsplit('.', 1)[-1].lower() not in allowed:
            fail('Поддерживаются изображения, PDF, офисные документы, TXT, CSV и архивы')
        fid = uid()
        path = data / 'uploads' / fid
        size = 0
        try:
            with path.open('xb') as output:
                while True:
                    chunk = uploaded.stream.read(65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > 25 * 1024 * 1024:
                        fail('Максимальный размер файла — 25 МБ', 413)
                    output.write(chunk)
            q('INSERT INTO files VALUES(?,?,?,?,?,?)', (fid, tid, g.user['id'], name, size, now()))
            activity(t['project_id'], tid, f'Прикрепил(а) файл «{name}»')
            db().commit()
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return jsonify(id=fid), 201

    @app.get('/api/files/<fid>')
    def download(fid):
        f = one('SELECT * FROM files WHERE id=?', (fid,))
        if not f:
            fail('Файл не найден', 404)
        get_task(f['task_id'])
        return send_file(data / 'uploads' / fid, as_attachment=True, download_name=f['name'], mimetype='application/octet-stream')

    @app.delete('/api/files/<fid>')
    def delete_file(fid):
        f = one('SELECT * FROM files WHERE id=?', (fid,))
        if not f:
            fail('Файл не найден', 404)
        get_task(f['task_id'], True)
        q('DELETE FROM files WHERE id=?', (fid,))
        db().commit()
        purge_files([f])
        return jsonify(ok=True)

    @app.patch('/api/profile')
    def profile():
        b=body()
        if any(key in b for key in ('password','new_password','current_password','login','phone','telegram_id')):
            fail('Эти данные нельзя менять через профиль',400)
        name=text(b.get('name',g.user['name']),'Имя',80)
        q('UPDATE users SET name=?,updated_at=? WHERE id=?',(name,now(),g.user['id']))
        return jsonify(ok=True)

    @app.get('/api/telegram')
    def telegram_info():
        return jsonify(configured=bool(store.send),linked=bool(g.user['telegram_verified_at']),enabled=bool(g.user['telegram_enabled']))

    @app.patch('/api/telegram')
    def telegram_update():
        b=body()
        if b.get('unlink'):
            fail('Telegram используется для входа. Обратитесь к руководителю для смены привязки.')
        if not isinstance(b.get('enabled'),bool):
            fail('Некорректное значение')
        q('UPDATE users SET telegram_enabled=? WHERE id=?',(int(b['enabled']),g.user['id']))
        return jsonify(ok=True)

    return app


app = create_app()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 8087)), debug=False, threaded=True)
