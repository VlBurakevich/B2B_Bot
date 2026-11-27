import os,sqlite3,tempfile,unittest
from pathlib import Path
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
os.environ.setdefault('DATA_DIR',tempfile.mkdtemp(prefix='kaiten-migration-import-'))
from app import create_app,now
from access import load_secret,permissions

class PhoneMigrationTest(unittest.TestCase):
    def test_existing_ids_work_history_and_roles_survive_old_sessions_do_not(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'focus.sqlite3'
            with closing(sqlite3.connect(path)) as c,c:
                c.executescript((Path(__file__).parent/'fixtures/schema_v1.sql').read_text())
                c.execute('INSERT INTO users(id,name,email,password,role,telegram_chat,created_at) VALUES(?,?,?,?,?,?,?)',('old','Старый Руководитель','old@example.ru','legacy-hash','admin','999',now()))
                c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',('p','Исторический проект','','#dc4c3e','old',now()))
                c.execute('INSERT INTO project_members VALUES(?,?)',('p','old'))
                c.execute('INSERT INTO tasks(id,project_id,title,assignee_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',('t','p','Историческая задача','old','old',now(),now()))
                c.execute('INSERT INTO comments VALUES(?,?,?,?,?)',('comment','t','old','Сохранённый комментарий',now()))
                c.execute('INSERT INTO sessions VALUES(?,?,?,?)',('old-session','old','old-csrf',9999999999))
                c.execute('INSERT INTO invites VALUES(?,?,?,?,?,?,?)',('invite','token','name@example.ru','employee','old',9999999999,0))
            sent=[]
            config={'TESTING':True,'DATA_DIR':folder,'PUBLIC_URL':'http://localhost','AUTH_SEND':lambda kind,b:sent.append(b)}
            app=create_app(config);store=app.extensions['access_store']
            with store.transaction() as c:
                self.assertEqual(c.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
                self.assertEqual(c.execute('SELECT used FROM invites').fetchone()[0],1)
                self.assertIn('admin.access.manage',permissions(c,'old'))
                user=c.execute('SELECT * FROM users WHERE id="old"').fetchone()
                self.assertEqual(user['role'],'admin');self.assertEqual(user['status'],'active');self.assertIsNone(user['telegram_verified_at'])
                self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
            # The verified contact is deliberately linked by exact historical ID, not by name.
            store.registration({'message_id':1,'chat':{'id':123,'type':'private'},'from':{'id':123},'contact':{'user_id':123,'phone_number':'+79990000123'}},'123:1')
            store.bind_existing('old','123','+79990000123')
            client=app.test_client();client.environ_base['HTTP_ORIGIN']='http://localhost'
            client.post('/api/auth/request-code',json={'phone':'+79990000123'})
            r=client.post('/api/auth/verify',json={'phone':'+79990000123','code':sent[-1]['code']})
            self.assertEqual(r.status_code,200);self.assertEqual(r.json['user']['id'],'old')
            self.assertNotIn('login',r.json['user']);self.assertNotIn('password',r.json['user'])
            self.assertEqual(client.get('/api/workspace').json['tasks'][0]['id'],'t')
            self.assertEqual(client.get('/api/tasks/t').json['comments'][0]['body'],'Сохранённый комментарий')
            # Repeat startup does not revoke valid new sessions or duplicate migrated permissions.
            second=create_app(config)
            with second.extensions['access_store'].transaction() as c:
                self.assertEqual(c.execute('SELECT count(*) FROM sessions').fetchone()[0],1)
                self.assertEqual(c.execute('SELECT count(*) FROM users').fetchone()[0],1)
    def test_secret_creation_is_atomic_across_workers(self):
        with tempfile.TemporaryDirectory() as folder:
            with ThreadPoolExecutor(max_workers=8) as pool:keys=list(pool.map(lambda _:load_secret(folder),range(16)))
            self.assertEqual(len(set(keys)),1);self.assertEqual(len(keys[0]),32)
            self.assertEqual((Path(folder)/'phone-auth.key').stat().st_mode&0o777,0o600)

if __name__=='__main__':unittest.main()
