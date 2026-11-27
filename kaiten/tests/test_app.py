import io
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from urllib.parse import urlsplit, parse_qs

os.environ.setdefault('DATA_DIR', tempfile.mkdtemp(prefix='focus-import-'))
os.environ['SETUP_TOKEN'] = 'test-setup-key'
from app import create_app, today
from helpers import Fixture


class FocusTest(Fixture,unittest.TestCase):
    def setUp(self):
        self.fixture()
        self.pid = self.post(self.admin, '/projects', {'title': 'Совместный проект'}, self.ah).json['id']
        self.patch(self.admin, '/projects/' + self.pid, {'members': [self.aid, self.eid]}, self.ah)

    def tearDown(self):
        self.temp.cleanup()

    def task(self, **values):
        r = self.post(self.admin, '/tasks', {'project_id': self.pid, 'title': 'Задача', **values}, self.ah)
        self.assertEqual(r.status_code, 201, r.json)
        return r.json

    def test_login_logout_and_csrf(self):
        c=self.client()
        self.assertEqual(c.get('/api/workspace').status_code,401)
        r=self.login(c,'+79990000002')
        cookie=r.headers['Set-Cookie']
        self.assertIn('HttpOnly',cookie); self.assertIn('Secure',cookie); self.assertIn('SameSite=Strict',cookie)
        self.assertIn('Max-Age=2592000',cookie)
        self.assertEqual(c.post('/api/projects',json={'title':'Fail'}).status_code,403)
        self.assertEqual(c.post('/api/auth/logout',headers={'X-CSRF-Token':r.json['csrf']}).status_code,200)
        self.assertEqual(c.get('/api/auth/me').status_code,401)

    def test_cross_origin_post_denied(self):
        headers = {**self.ah, 'Origin': 'https://evil.example'}
        self.assertEqual(self.post(self.admin, '/projects', {'title': 'Fail'}, headers).status_code, 403)

    def test_employee_creates_own_project_and_admin_sees_it(self):
        p = self.post(self.employee, '/projects', {'title': 'Личный проект'}, self.eh)
        self.assertEqual(p.status_code, 201)
        eid = p.json['id']
        self.assertIn(eid, [x['id'] for x in self.admin.get('/api/workspace').json['projects']])
        self.assertNotIn(eid, [x['id'] for x in self.outsider.get('/api/workspace').json['projects']])

    def test_project_and_task_visibility_enforced(self):
        task = self.task()
        self.assertEqual(self.outsider.get('/api/tasks/' + task['id']).status_code, 404)
        self.assertNotIn(task['id'], [x['id'] for x in self.outsider.get('/api/workspace').json['tasks']])
        denied = self.post(self.outsider, '/tasks', {'project_id': self.pid, 'title': 'No'}, self.oh)
        self.assertEqual(denied.status_code, 404)

    def test_only_admin_can_assign_others(self):
        r = self.post(self.employee, '/tasks', {'project_id': self.pid, 'title': 'Назначение', 'assignee_id': self.aid}, self.eh)
        self.assertEqual(r.status_code, 403)
        task = self.task(assignee_id=self.eid)
        self.assertEqual(task['assignee_id'], self.eid)
        r = self.patch(self.employee, '/tasks/' + task['id'], {'title': 'Сделаю', 'version': task['version']}, self.eh)
        self.assertEqual(r.status_code, 200)

    def test_employee_self_task_and_collaboration(self):
        r = self.post(self.employee, '/tasks', {'project_id': self.pid, 'title': 'Вместе', 'participants': [self.aid]}, self.eh)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json['assignee_id'], self.eid)
        self.assertIn(self.aid, r.json['participants'])

    def test_nonparticipant_cannot_edit_but_can_comment(self):
        task = self.task()
        r = self.patch(self.employee, '/tasks/' + task['id'], {'version': 1, 'title': 'No'}, self.eh)
        self.assertEqual(r.status_code, 403)
        r = self.post(self.employee, '/tasks/' + task['id'] + '/comments', {'body': '<script>alert(1)</script>'}, self.eh)
        self.assertEqual(r.status_code, 201)
        detail = self.admin.get('/api/tasks/' + task['id']).json
        self.assertEqual(detail['comments'][0]['body'], '<script>alert(1)</script>')

    def test_nested_subtasks_independent_dates_and_priority_status(self):
        parent = self.task(priority='4', due_date='2026-12-10')
        child = self.task(parent_id=parent['id'], due_date=today(), due_time='15:30', assignee_id=self.eid, priority='20', status='doing')
        nested = self.task(parent_id=child['id'], due_date='2026-12-01')
        self.assertEqual(nested['parent_id'], child['id'])
        self.assertEqual(self.employee.get('/api/tasks/' + child['id']).json['due_date'], today())
        updated = self.patch(self.admin, '/tasks/' + child['id'], {'priority': '80', 'version': 1}, self.ah)
        self.assertEqual(updated.json['status'], 'doing')
        self.assertEqual(updated.json['priority'], '80')

    def test_no_cross_project_subtask(self):
        parent = self.task()
        pid = self.post(self.admin, '/projects', {'title': 'Второй'}, self.ah).json['id']
        r = self.post(self.admin, '/tasks', {'project_id': pid, 'parent_id': parent['id'], 'title': 'No'}, self.ah)
        self.assertEqual(r.status_code, 400)

    def test_concurrent_edit_conflict(self):
        task = self.task()
        r = self.patch(self.admin, '/tasks/' + task['id'], {'title': 'Изменено', 'version': 1}, self.ah)
        self.assertEqual(r.status_code, 200)
        r = self.patch(self.admin, '/tasks/' + task['id'], {'title': 'Потеря', 'version': 1}, self.ah)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.admin.get('/api/tasks/' + task['id']).json['title'], 'Изменено')

    def test_parent_completion_and_reopening(self):
        parent = self.task()
        child = self.task(parent_id=parent['id'])
        r = self.patch(self.admin, '/tasks/' + parent['id'], {'status': 'done', 'version': 1}, self.ah)
        self.assertEqual(r.status_code, 409)
        self.patch(self.admin, '/tasks/' + child['id'], {'status': 'done', 'version': 1}, self.ah)
        r = self.patch(self.admin, '/tasks/' + parent['id'], {'status': 'done', 'version': 1}, self.ah)
        self.assertEqual(r.status_code, 200)
        self.patch(self.admin, '/tasks/' + child['id'], {'status': 'todo', 'version': 2}, self.ah)
        self.assertEqual(self.admin.get('/api/tasks/' + parent['id']).json['status'], 'todo')

    def test_upload_download_acl_delete_and_cascade(self):
        parent = self.task()
        child = self.task(parent_id=parent['id'])
        r = self.admin.post('/api/tasks/' + child['id'] + '/files', data={'file': (io.BytesIO(b'test file'), '../../план.txt')}, headers=self.ah)
        self.assertEqual(r.status_code, 201, r.json)
        fid = r.json['id']
        self.assertEqual(self.outsider.get('/api/files/' + fid).status_code, 404)
        download = self.employee.get('/api/files/' + fid)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.data, b'test file')
        self.assertIn('attachment', download.headers['Content-Disposition'])
        download.close()
        detail = self.admin.get('/api/tasks/' + child['id']).json
        self.assertEqual(detail['files'][0]['name'], 'план.txt')
        self.assertEqual(self.admin.delete('/api/tasks/' + parent['id'], headers=self.ah).status_code, 200)
        self.assertEqual(self.admin.get('/api/tasks/' + child['id']).status_code, 404)
        self.assertEqual(self.admin.get('/api/files/' + fid).status_code, 404)
        self.assertFalse(os.path.exists(os.path.join(self.temp.name, 'uploads', fid)))

    def test_block_executable_upload(self):
        task = self.task()
        r = self.admin.post('/api/tasks/' + task['id'] + '/files', data={'file': (io.BytesIO(b'<script>'), 'evil.html')}, headers=self.ah)
        self.assertEqual(r.status_code, 400)

    def test_old_auth_routes_cannot_be_used(self):
        for path in ('/api/auth/login','/api/auth/setup','/api/auth/register','/api/admin/invites','/api/telegram/link'):
            self.assertEqual(self.admin.post(path,json={'login':'admin','password':'old'},headers=self.ah).status_code,404,path)
        self.assertEqual(self.admin.get('/api/auth/invite?token=old').status_code,404)

    def test_disabling_user_revokes_session(self):
        users=self.admin.get('/api/access').json['users']; u=next(u for u in users if u['id']==self.eid)
        r=self.post(self.admin,'/access/update',{'userId':self.eid,'version':u['access_version'],'status':'blocked','role':'employee','permissions':u['permissions']},self.ah)
        self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(self.employee.get('/api/me').status_code,401)

    def test_project_member_removal_guard(self):
        self.task(assignee_id=self.eid)
        r = self.patch(self.admin, '/projects/' + self.pid, {'members': [self.aid]}, self.ah)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(len(self.employee.get('/api/workspace').json['projects']), 1)

    def test_validation_and_telegram_not_configured(self):
        for extra in [{'due_date': '2026-99-99'}, {'participants': [{}]}, {'title': ''}, {'priority': '1'}]:
            r = self.post(self.admin, '/tasks', {'project_id': self.pid, 'title': 'X', **extra}, self.ah)
            self.assertEqual(r.status_code, 400, r.json)
        self.assertTrue(self.employee.get('/api/telegram').json['configured'])
        self.assertEqual(self.employee.post('/api/telegram/link', headers=self.eh).status_code, 404)

    def test_assignment_notifications_queued(self):
        self.task(assignee_id=self.eid)
        with closing(sqlite3.connect(self.app.config['DB_PATH'])) as db:
            count = db.execute('SELECT COUNT(*) FROM outbox WHERE user_id=?', (self.eid,)).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == '__main__':
    unittest.main()
