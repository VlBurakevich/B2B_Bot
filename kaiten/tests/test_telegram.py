import unittest
from helpers import Fixture
from telegram_worker import send_pending

class NotificationTest(Fixture,unittest.TestCase):
    def setUp(self):self.fixture();self.codes.clear()
    def tearDown(self):self.temp.cleanup()
    def queue(self):
        p=self.admin.post('/api/projects',json={'title':'Общий'},headers=self.ah).json
        self.admin.patch('/api/projects/'+p['id'],json={'members':[self.aid,self.eid]},headers=self.ah)
        t=self.admin.post('/api/tasks',json={'title':'Задача','project_id':p['id'],'assignee_id':self.eid},headers=self.ah).json
        return p,t
    def test_notifications_use_bridge_and_not_second_telegram_poller(self):
        p,t=self.queue();send_pending(self.store);send_pending(self.store)
        self.assertEqual(len(self.codes),1);self.assertEqual(self.codes[0][0],'notify');self.assertEqual(self.codes[0][1]['chatId'],'102')
    def test_revoked_membership_prevents_task_content_delivery(self):
        p,t=self.queue()
        with self.store.transaction() as c:c.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?',(p['id'],self.eid))
        send_pending(self.store);self.assertEqual(self.codes,[])
    def test_blocked_account_does_not_receive_task_notifications(self):
        self.queue()
        with self.store.transaction() as c:c.execute("UPDATE users SET status='blocked',active=0 WHERE id=?",(self.eid,))
        send_pending(self.store);self.assertEqual(self.codes,[])
    def test_registration_notification_and_retry(self):
        m={'message_id':1,'chat':{'id':200,'type':'private'},'from':{'id':200},'contact':{'user_id':200,'phone_number':'+79990000200'}}
        self.store.registration(m,'200:1');m={'message_id':2,'chat':{'id':200,'type':'private'},'from':{'id':200},'text':'Новый Пользователь'}
        self.store.registration(m,'200:2');self.store.flush_notifications();self.store.flush_notifications()
        self.assertEqual(len(self.codes),1);self.assertIn('Новая заявка Kaiten',self.codes[0][1]['text'])

if __name__=='__main__':unittest.main()
