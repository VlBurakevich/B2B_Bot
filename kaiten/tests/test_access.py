import copy,json,sqlite3,threading,unittest
from concurrent.futures import ThreadPoolExecutor
from helpers import Fixture
from access import AccessError,NEUTRAL,EMPLOYEE,normalize_phone,public_user,permissions
from telegram_bridge import signed_headers

class PhoneAccessTest(Fixture,unittest.TestCase):
    def setUp(self):self.fixture();self.codes.clear()
    def tearDown(self):self.temp.cleanup()
    def request(self,phone='+79990000002',ip='otp-ip'):
        self.clock[0]+=61
        return self.store.request_code(phone,ip)
    def verify(self,code=None,phone='+79990000002',ip='verify-ip'):
        return self.store.verify(phone,code if code is not None else self.codes[-1][1]['code'],ip)
    def user(self,identifier):
        with self.store.transaction() as c:return public_user(c,identifier,True)
    def change(self,identifier,**changes):
        user=self.user(identifier)
        return self.store.change_access(self.aid,0,{'userId':identifier,'version':user['access_version'],'status':user['status'],'role':user['role'],'permissions':user['permissions'],**changes})
    def message(self,tg=200,mid=1,**extra):
        return {'message_id':mid,'chat':{'id':tg,'type':'private'},'from':{'id':tg,'username':'test_user'},**extra}
    def register(self,tg=200,phone='+79990000200'):
        self.store.registration(self.message(tg,1,contact={'user_id':tg,'phone_number':phone}),f'{tg}:1')
        self.store.registration(self.message(tg,2,text='Иванов Иван Иванович'),f'{tg}:2')
        with self.store.transaction() as c:return dict(c.execute('SELECT * FROM users WHERE telegram_id=? AND linked_to IS NULL',(str(tg),)).fetchone())
    def test_phone_normalization(self):
        for value in ['+7 (999) 000-00-02','89990000002','9990000002','+7\u00a0999\u00a0000-00-02']:
            self.assertEqual(normalize_phone(value),'+79990000002')
        for value in ['+19990000002','abc',True,'+7١٢٣٤٥٦٧٨٩٠',None,'7'*41]:self.assertIsNone(normalize_phone(value))
    def test_neutral_response_for_every_access_state(self):
        pending=self.register()
        self.change(self.oid,status='blocked')
        for number in ['+79990000002','+79990000003','+79990000200','+79990000999']:
            self.assertEqual(self.store.request_code(number,'neutral-'+number),NEUTRAL)
        self.assertEqual(len(self.codes),1)
    def test_full_access_required_even_for_active(self):
        u=self.user(self.eid)
        self.change(self.eid,permissions=[p for p in u['permissions'] if p!='platform.full_access'])
        self.assertEqual(self.request(),NEUTRAL);self.assertEqual(self.codes,[])
    def test_unverified_legacy_chat_is_not_enough(self):
        with self.store.transaction() as c:c.execute('UPDATE users SET telegram_verified_at=NULL WHERE id=?',(self.eid,))
        self.assertEqual(self.request(),NEUTRAL);self.assertEqual(self.codes,[])
    def test_full_60_second_cooldown(self):
        self.request();self.assertEqual(len(self.codes),1)
        self.clock[0]+=59;self.store.request_code('+79990000002','cooldown-ip');self.assertEqual(len(self.codes),1)
        self.clock[0]+=1;self.store.request_code('+79990000002','cooldown-ip');self.assertEqual(len(self.codes),2)
    def test_phone_and_ip_rate_limits(self):
        self.clock[0]+=901
        for _ in range(6):self.request(ip='phone-limit')
        self.assertEqual(len(self.codes),5)
        with self.assertRaises(AccessError) as ctx:
            for n in range(21):self.store.request_code('+7999000'+f'{n:04d}','flood-ip')
        self.assertEqual(ctx.exception.status,429)
    def test_code_hash_and_single_use(self):
        self.request();code=self.codes[-1][1]['code'];self.assertRegex(code,r'^\d{6}$')
        with self.store.transaction() as c:
            row=c.execute('SELECT * FROM phone_challenges').fetchone();self.assertNotEqual(row['code_hash'],code);self.assertEqual(len(row['code_hash']),64)
        result=self.verify(code);self.assertEqual(result['user']['id'],self.eid)
        with self.assertRaises(AccessError):self.verify(code)
        with self.store.transaction() as c:self.assertIsNone(c.execute('SELECT 1 FROM sessions WHERE token=?',(result['token'],)).fetchone())
    def test_code_expires_at_ten_minutes(self):
        self.request();self.clock[0]+=600
        with self.assertRaises(AccessError):self.verify()
    def test_only_five_wrong_attempts(self):
        self.request();good=self.codes[-1][1]['code'];bad='000000' if good!='000000' else '999999'
        for _ in range(5):
            with self.assertRaises(AccessError):self.verify(bad)
        with self.assertRaises(AccessError):self.verify(good)
    def test_wrong_format_consumes_attempt(self):
        self.request()
        for bad in ['',None,'1234567','１２３４５６','abc']:
            with self.assertRaises(AccessError):self.store.verify('+79990000002',bad,'invalid-format')
        with self.assertRaises(AccessError):self.verify()
    def test_replacement_invalidates_old_code(self):
        self.request();old=self.codes[-1][1]['code'];self.request();new=self.codes[-1][1]['code']
        if old!=new:
            with self.assertRaises(AccessError):self.verify(old)
        self.assertEqual(self.verify(new)['user']['id'],self.eid)
    def test_delivery_failure_is_neutral_and_no_code_survives(self):
        self.store.send=lambda *args:(_ for _ in ()).throw(RuntimeError('offline'))
        self.assertEqual(self.request(),NEUTRAL)
        with self.store.transaction() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM phone_challenges').fetchone()[0],0)
    def test_revoke_while_code_is_being_sent(self):
        def send(kind,payload):
            self.codes.append((kind,dict(payload)));self.change(self.eid,status='blocked')
        self.store.send=send;self.request()
        with self.assertRaises(AccessError):self.verify()
    def test_concurrent_code_consumption_only_creates_one_session(self):
        self.request();barrier=threading.Barrier(2)
        with self.store.transaction() as c:c.execute('DELETE FROM sessions WHERE user_id=?',(self.eid,))
        def attempt(_):
            barrier.wait()
            try:return self.verify()['user']['id']
            except AccessError:return None
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,range(2)))
        self.assertEqual(results.count(self.eid),1)
        with self.store.transaction() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?',(self.eid,)).fetchone()[0],1)
    def test_concurrent_revoke_and_verify_never_leaves_access(self):
        self.request();barrier=threading.Barrier(2)
        def verify():
            barrier.wait()
            try:self.verify()
            except AccessError:pass
        def revoke():barrier.wait();self.change(self.eid,status='blocked')
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(verify),pool.submit(revoke)]
            for f in futures:f.result()
        with self.store.transaction() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?',(self.eid,)).fetchone()[0],0)
    def test_permission_revocation_is_immediate_and_cannot_restore_old_session(self):
        self.change(self.eid,permissions=['platform.full_access'])
        self.assertEqual(self.employee.get('/api/workspace').status_code,401)
        self.change(self.eid,permissions=EMPLOYEE)
        self.assertEqual(self.employee.get('/api/auth/me').status_code,401)
    def test_each_function_requires_its_permission(self):
        self.change(self.eid,permissions=['platform.full_access'])
        r=self.login(self.employee,'+79990000002');headers={'X-CSRF-Token':r.json['csrf']}
        self.assertEqual(self.employee.get('/api/access').status_code,403)
        self.assertEqual(self.employee.post('/api/projects',json={'title':'denied'},headers=headers).status_code,403)
        self.assertEqual(self.employee.get('/api/workspace').json['tasks'],[])
        self.assertEqual(self.employee.get('/api/workspace').json['projects'],[])
    def test_last_admin_cannot_be_blocked_or_lose_access(self):
        for change in [{'status':'blocked'},{'permissions':['platform.full_access']}]:
            with self.assertRaises(AccessError) as ctx:self.change(self.aid,**change)
            self.assertEqual(ctx.exception.status,409)
    def test_stale_admin_card_rejected(self):
        u=self.user(self.eid);self.change(self.eid,status='blocked')
        with self.assertRaises(AccessError) as ctx:self.store.change_access(self.aid,0,{'userId':self.eid,'version':u['access_version'],'status':'active','role':'employee','permissions':EMPLOYEE})
        self.assertEqual(ctx.exception.status,409)
    def test_session_revoke_during_admin_request_rechecked(self):
        self.store.change_access(self.aid,0,{'userId':self.aid,'version':self.user(self.aid)['access_version'],'action':'revoke-sessions'})
        with self.assertRaises(AccessError):self.change(self.eid,status='blocked')
    def test_registration_requires_private_own_contact(self):
        group=self.message();group['chat']['type']='group'
        with self.assertRaises(AccessError):self.store.registration(group,'200:1')
        m=self.message(contact={'user_id':201,'phone_number':'+79990000200'})
        self.assertIn('собственный',self.store.registration(m,'200:1')['text'])
        self.store.registration(self.message(mid=2,text='Подставное Имя'),'200:2')
        with self.store.transaction() as c:self.assertEqual(c.execute('SELECT count(*) FROM users').fetchone()[0],3)
    def test_registration_pending_idempotent_no_rights_and_admin_notification(self):
        user=self.register();self.assertEqual(user['status'],'pending');self.assertEqual(user['active'],0)
        self.store.registration(self.message(mid=2,text='Иванов Иван Иванович'),'200:2')
        with self.store.transaction() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM users').fetchone()[0],4)
            self.assertEqual(permissions(c,user['id']),[])
            self.assertEqual(c.execute("SELECT count(*) FROM access_outbox WHERE kind='registration'").fetchone()[0],1)
        self.assertEqual(self.request('+79990000200'),NEUTRAL);self.assertEqual(self.codes,[])
    def test_phone_and_telegram_unique_even_when_blocked(self):
        user=self.register();self.change(user['id'],status='blocked')
        r=self.store.registration(self.message(201,1,contact={'user_id':201,'phone_number':'+79990000200'}),'201:1')
        self.assertIn('другим Telegram',r['text'])
        r=self.store.registration(self.message(200,3,contact={'user_id':200,'phone_number':'+79990000300'}),'200:3')
        self.assertIn('уже связан',r['text'])
    def test_approve_then_login_and_block_without_deleting_card(self):
        user=self.register();self.change(user['id'],status='active',permissions=EMPLOYEE)
        self.request('+79990000200');result=self.verify(phone='+79990000200')
        self.assertEqual(result['user']['id'],user['id']);self.change(user['id'],status='blocked')
        retained=self.user(user['id']);self.assertEqual(retained['phone'],'+79990000200');self.assertEqual(retained['telegram_id'],'200')
        self.assertIsNotNone(retained['reviewed_at'])
    def test_bind_existing_preserves_id_and_archives_pending_card(self):
        with self.store.transaction() as c:c.execute('UPDATE users SET phone=NULL,telegram_id=NULL,telegram_chat=NULL,telegram_verified_at=NULL WHERE id=?',(self.eid,))
        pending=self.register()
        self.store.bind_existing(self.eid,'200','+79990000200')
        self.assertEqual(self.user(self.eid)['phone'],'+79990000200')
        self.assertEqual(self.user(pending['id'])['linked_to'],self.eid)
        self.assertEqual(self.user(pending['id'])['phone'],'+79990000200')
        self.assertEqual(self.user(pending['id'])['status'],'blocked')
    def test_binding_never_matches_names_or_unverified_phones(self):
        with self.store.transaction() as c:c.execute('UPDATE users SET phone=NULL,telegram_id=NULL WHERE id=?',(self.eid,))
        with self.assertRaises(AccessError):self.store.bind_existing(self.eid,'999','+79990000999')
    def test_exact_origin_is_required_for_login(self):
        c=self.app.test_client()
        for headers in [{},{'Origin':'https://evil.example'},{'Origin':'https://localhost'}]:
            self.assertEqual(c.post('/api/auth/request-code',json={'phone':'+79990000002'},headers=headers).status_code,403)
    def test_bridge_signature_service_and_replay(self):
        key='12'*32;self.app.config['KAITEN_BRIDGE_KEY']=key
        raw=json.dumps({'message':self.message(text='/start'),'eventId':'200:1'},separators=(',',':')).encode()
        path='/api/telegram-bridge/message'
        headers=signed_headers(key,'kaiten-test',path,raw,lambda:self.clock[0])
        c=self.app.test_client()
        self.assertEqual(c.post(path,data=raw,headers=headers).status_code,200)
        self.assertEqual(c.post(path,data=raw,headers=headers).status_code,401)
        headers=signed_headers(key,'kaiten',path,raw,lambda:self.clock[0])
        self.assertEqual(c.post(path,data=raw,headers=headers).status_code,401)
        self.assertEqual(c.post(path,json={}).status_code,401)
    def test_session_expiry_30_days(self):
        self.clock[0]+=30*86400
        self.assertEqual(self.employee.get('/api/auth/me').status_code,401)
    def test_audit_records_rights_delta_and_login(self):
        self.change(self.eid,permissions=['platform.full_access'])
        events=self.admin.get('/api/access/audit').json['events']
        change=next(e for e in events if e['action']=='access.changed')
        self.assertIn('tasks.edit',change['detail']['before']['permissions'])
        self.assertEqual(change['detail']['after']['permissions'],['platform.full_access'])
        self.assertTrue(any(e['action']=='auth.login' for e in events))

    def test_auth_json_size_is_bounded(self):
        c=self.client()
        self.assertEqual(c.post('/api/auth/request-code',json={'phone':'+79990000002','padding':'x'*5000}).status_code,413)
    def test_https_origin_forces_secure_cookie_configuration(self):
        from app import create_app
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            secure=create_app({'TESTING':True,'DATA_DIR':folder,'PUBLIC_URL':'https://test.example','COOKIE_SECURE':False})
            self.assertTrue(secure.config['COOKIE_SECURE'])

    def test_revocation_during_request_body_read_is_rechecked_before_mutation(self):
        import io
        outer=self
        class RevokingBody(io.BytesIO):
            revoked=False
            def readinto(self,buffer):
                if not self.revoked:
                    self.revoked=True
                    outer.change(outer.eid,status='blocked')
                return super().readinto(buffer)
        raw=b'{"title":"Must not be created"}'
        stream=RevokingBody(raw)
        response=self.employee.open('/api/projects',method='POST',input_stream=stream,content_type='application/json',content_length=len(raw),headers=self.eh)
        self.assertTrue(stream.revoked)
        self.assertEqual(response.status_code,401,response.json)
        with self.store.transaction() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM projects').fetchone()[0],0)

if __name__=='__main__':unittest.main()
