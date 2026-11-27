"""Optional demo content for a SEPARATE empty database. Never runs on startup."""
import os
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from access import ADMIN, EMPLOYEE
from app import app, now, today, uid

if os.environ.get('KAITEN_DEMO_MODE')!='local-fixture' or not app.config['PUBLIC_URL'].startswith('http://127.0.0.1:') or app.config['KAITEN_BOT_ORIGIN']:
    raise SystemExit('Synthetic identities may be seeded only in an isolated local fixture without a real bot bridge.')
db = sqlite3.connect(app.config['DB_PATH'])
db.execute('PRAGMA foreign_keys=ON')
if db.execute('SELECT 1 FROM users').fetchone():
    raise SystemExit('Refusing to seed a non-empty database.')
stamp = now()
users = [('demo-admin', 'Александр Волков', 'alex@focus.local', 'admin'),
         ('demo-anna', 'Анна Смирнова', 'anna@focus.local', 'employee'),
         ('demo-max', 'Максим Орлов', 'max@focus.local', 'employee'),
         ('demo-maria', 'Мария Соколова', 'maria@focus.local', 'employee')]
for id, name, email, role in users:
    db.execute('INSERT INTO users(id,name,login,password,role,created_at) VALUES(?,?,?,?,?,?)',
               (id, name, email.split('@')[0], '!disabled', role, stamp))
projects = [('demo-launch','Запуск продукта','От первой идеи до первых пользователей. Собираем важное в одном месте.','#7471ed'),
            ('demo-marketing','Маркетинг','Планы, гипотезы и новые точки роста.','#d0ae66'),
            ('demo-ops','Операционные задачи','Чтобы ежедневная работа шла спокойно.','#6da48f')]
for pid, title, description, color in projects:
    db.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', (pid, title, description, color, 'demo-admin', stamp))
    for id,*_ in users:
        db.execute('INSERT INTO project_members VALUES(?,?)', (pid,id))
day = date.fromisoformat(today())
def deadline(delta):
    return (day+timedelta(days=delta)).isoformat() if delta is not None else None

tasks = [
 ('t1','Согласовать стратегию запуска','Определить позиционирование, ключевые сообщения и метрики успеха.','4','doing',0,'demo-admin',None),
 ('t2','Провести интервью с клиентами','Проверить гипотезы с пятью потенциальными пользователями.','4','todo',1,'demo-anna',None),
 ('t3','Подготовить прототип продукта','Собрать ключевые сценарии и проверить их вместе с командой.','20','doing',1,'demo-max',None),
 ('t4','Собрать обратную связь','Структурировать замечания и выбрать следующий шаг.','20','todo',2,'demo-maria',None),
 ('t5','Обновить базу знаний','Добавить инструкции для новых участников команды.','80','todo',3,'demo-anna',None),
 ('t6','Подготовить еженедельный отчёт','','80','todo',0,'demo-admin',None),
 ('t7','Автоматизировать сбор метрик','Посмотреть инструменты и оценить трудозатраты.','backlog','todo',None,'demo-max',None),
 ('t8','Идеи для следующего релиза','','backlog','todo',None,'demo-maria',None),
 ('s11','Сформулировать цели запуска','','4','done',0,'demo-admin','t1'),
 ('s12','Согласовать бюджет и сроки','','4','todo',0,'demo-admin','t1'),
 ('s13','Распределить зоны ответственности','','4','todo',1,'demo-admin','t1'),
 ('s31','Спроектировать основные экраны','','20','done',0,'demo-max','t3'),
 ('s32','Собрать кликабельный прототип','','20','doing',1,'demo-max','t3'),
 ('s33','Провести проверку сценариев','','20','todo',2,'demo-max','t3'),
 ('s34','Подготовить макеты к передаче','','20','todo',3,'demo-max','t3')]
for i,(tid,title,description,priority,status,due,assignee,parent) in enumerate(tasks):
    db.execute('INSERT INTO tasks(id,project_id,parent_id,title,description,priority,status,due_date,assignee_id,created_by,position,created_at,updated_at) '
               'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
               (tid,'demo-launch',parent,title,description,priority,status,deadline(due),assignee,'demo-admin',i,stamp,stamp))
for tid,who in [('t1','demo-anna'),('t1','demo-maria'),('t2','demo-admin'),('t3','demo-anna'),('t7','demo-admin')]:
    db.execute('INSERT INTO task_members VALUES(?,?)', (tid,who))
for tid,who,comment in [('t1','demo-anna','Предлагаю начать с текущих клиентов — так быстрее проверим ценность.'),
                        ('t1','demo-admin','Согласен. Обсудим первые результаты на встрече команды.'),
                        ('t3','demo-max','Первые экраны готовы. Следующий шаг — собрать переходы.')]:
    db.execute('INSERT INTO comments VALUES(?,?,?,?,?)', (uid(),tid,who,comment,stamp))
db.execute('INSERT INTO tasks(id,project_id,title,priority,status,due_date,assignee_id,created_by,created_at,updated_at) '
           'VALUES(?,?,?,?,?,?,?,?,?,?)', ('m1','demo-marketing','Подготовить контент-план','20','doing',deadline(-1),'demo-anna','demo-admin',stamp,stamp))
for pid, title, owner, color in [
        ('demo-anna-plan', 'Мой рабочий план', 'demo-anna', '#299b74'),
        ('demo-max-plan', 'Развитие продукта', 'demo-max', '#4073d6')]:
    db.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', (pid,title,'Личный проект сотрудника',color,owner,stamp))
    db.execute('INSERT INTO project_members VALUES(?,?)', (pid,owner))
for i,(tid,pid,title,description,priority,status,due,assignee,parent) in enumerate([
        ('a1','demo-anna-plan','Согласовать план на декабрь','Подготовить три главные цели и обсудить их на встрече.','4','todo',0,'demo-anna',None),
        ('a2','demo-anna-plan','Подготовить материалы к встрече','Собрать итоги недели и открытые вопросы.','20','doing',0,'demo-anna',None),
        ('a3','demo-anna-plan','Разобрать заметки после встреч','','80','todo',0,'demo-anna',None),
        ('a4','demo-anna-plan','Обновить рабочие документы','','80','done',0,'demo-anna',None),
        ('a5','demo-anna-plan','Изучить новые инструменты','','backlog','todo',None,'demo-anna',None),
        ('x1','demo-max-plan','Проверить сценарии нового релиза','Пройти основные пользовательские сценарии.','4','doing',0,'demo-max',None),
        ('x2','demo-max-plan','Собрать замечания команды','','20','todo',1,'demo-max',None),
        ('n1','demo-launch','Подготовить таблицу расходов','','4','todo',0,'demo-admin','s12')]):
    db.execute('INSERT INTO tasks(id,project_id,parent_id,title,description,priority,status,due_date,assignee_id,created_by,position,created_at,updated_at) '
               'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
               (tid,pid,parent,title,description,priority,status,deadline(due),assignee,assignee,30+i,stamp,stamp))
db.execute('UPDATE tasks SET due_time=? WHERE id=?', ('15:00','a1'))
for tid,name,text in [
        ('t1','План запуска.txt','Демонстрационный файл Kaiten\n\n1. Согласовать цели\n2. Утвердить бюджет\n3. Распределить ответственность\n'),
        ('s12','Бюджет и сроки.txt','Демонстрационное вложение подзадачи.\nУ каждой подзадачи свои файлы и сроки.\n')]:
    fid=uid()
    content=text.encode('utf-8')
    (Path(app.config['DATA_DIR'])/'uploads'/fid).write_bytes(content)
    db.execute('INSERT INTO files VALUES(?,?,?,?,?,?)', (fid,tid,'demo-admin',name,len(content),stamp))
for who,pid,tid,message in [('demo-admin','demo-launch','t1','Обновил(а) задачу «Согласовать стратегию запуска»'),
                            ('demo-max','demo-launch','t3','Добавил(а) комментарий к прототипу'),
                            ('demo-anna','demo-marketing','m1','Начал(а) подготовку контент-плана')]:
    db.execute('INSERT INTO activity(project_id,task_id,user_id,text,created_at) VALUES(?,?,?,?,?)', (pid,tid,who,message,stamp))
for i,(identifier,name,email,role) in enumerate(users,1):
    phone='+7000000000'+str(i)
    tg=str(9000000000000100+i)
    db.execute("UPDATE users SET phone=?,telegram_id=?,telegram_chat=?,telegram_verified_at=?,status='active',active=1,registered_at=?,updated_at=? WHERE id=?",(phone,tg,tg,1,stamp,stamp,identifier))
    for permission in ADMIN if role=='admin' else EMPLOYEE:
        db.execute('INSERT INTO access_permissions VALUES(?,?)',(identifier,permission))
db.commit()
db.close()
print('Local fixture created. Synthetic phones: +70000000001 (admin), +70000000002 (employee). No real Telegram delivery.')
