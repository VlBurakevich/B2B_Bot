"""Kaiten notification sender via the approved shared bot. This process never calls getUpdates."""
import fcntl
import logging
import time
from datetime import datetime
from pathlib import Path
from app import app,now,today,TZ
from access import eligible,permissions

log=logging.getLogger('kaiten.notifications')
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s')


def queue_reminders(store):
    current=datetime.now(TZ)
    if current.hour<9:return
    with store.transaction() as conn:
        for task in conn.execute("SELECT * FROM tasks WHERE status!='done' AND due_date<=?",(today(),)).fetchall():
            if task['due_date']==today() and task['due_time'] and current.strftime('%H:%M')<task['due_time']:continue
            label='Срок сегодня' if task['due_date']==today() else 'Задача просрочена'
            conn.execute('INSERT OR IGNORE INTO outbox(user_id,text,dedup,created_at,task_id) VALUES(?,?,?,?,?)',(task['assignee_id'],f"{label}: {task['title']}\n{store.origin}/?task={task['id']}",f"reminder:{task['id']}:{today()}",now(),task['id']))


def send_pending(store):
    if not store.send:return
    with store.transaction() as conn:
        items=[dict(row) for row in conn.execute('SELECT * FROM outbox WHERE sent=0 AND attempts<8 ORDER BY id LIMIT 20')]
    for item in items:
        with store.transaction() as conn:
            user=conn.execute('SELECT * FROM users WHERE id=?',(item['user_id'],)).fetchone()
            task=conn.execute('SELECT * FROM tasks WHERE id=?',(item['task_id'],)).fetchone()
            rights=permissions(conn,item['user_id'])
            member=task and conn.execute('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?',(task['project_id'],item['user_id'])).fetchone()
            allowed=eligible(conn,user) and user['telegram_enabled'] and all(p in rights for p in ('projects.read','tasks.read')) and task and (member or user['role']=='admin' and 'company.tasks.read' in rights)
            if not allowed:
                conn.execute('UPDATE outbox SET sent=2 WHERE id=?',(item['id'],));continue
            chat=user['telegram_id']
        try:
            # Stable UUID-compatible notification ID; namespaced to Kaiten by bridge signature.
            import uuid
            identifier=str(uuid.uuid5(uuid.NAMESPACE_URL,store.origin+'/notifications/'+str(item['id'])))
            store.send('notify',{'chatId':chat,'requestId':identifier,'text':item['text']})
            with store.transaction() as conn:conn.execute('UPDATE outbox SET sent=1 WHERE id=?',(item['id'],))
        except Exception:
            with store.transaction() as conn:conn.execute('UPDATE outbox SET attempts=attempts+1 WHERE id=?',(item['id'],))
            log.warning('Notification delivery deferred (id=%s)',item['id'])


def main():
    store=app.extensions['access_store']
    if not store.send:raise SystemExit('Shared Kaiten bot bridge is not configured')
    with (Path(app.config['DATA_DIR'])/'telegram.lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('Another Kaiten notification worker is running')
        previous=0
        while True:
            try:
                if time.monotonic()-previous>60:
                    queue_reminders(store);previous=time.monotonic()
                store.flush_notifications();send_pending(store)
            except Exception:log.warning('Notification retry scheduled')
            time.sleep(10)

if __name__=='__main__':main()
