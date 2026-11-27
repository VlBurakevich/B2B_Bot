import os,sqlite3,tempfile,uuid
from contextlib import closing
os.environ.setdefault('DATA_DIR',tempfile.mkdtemp(prefix='kaiten-import-'))
from app import create_app
from access import ADMIN,EMPLOYEE,stamp

class Fixture:
    def fixture(self):
        self.temp=tempfile.TemporaryDirectory()
        self.codes=[]; self.clock=[1800000000]
        self.app=create_app({'TESTING':True,'DATA_DIR':self.temp.name,'PUBLIC_URL':'http://localhost','COOKIE_SECURE':True,'AUTH_CLOCK':lambda:self.clock[0],'AUTH_SEND':lambda kind,b:self.codes.append((kind,dict(b)))})
        self.store=self.app.extensions['access_store']
        self.admin,self.aid,self.ah=self.account('Руководитель','admin','+79990000001',101)
        self.employee,self.eid,self.eh=self.account('Сотрудник','employee','+79990000002',102)
        self.outsider,self.oid,self.oh=self.account('Другой сотрудник','employee','+79990000003',103)
    def client(self):
        c=self.app.test_client();c.environ_base['HTTP_ORIGIN']='http://localhost';return c
    def account(self,name,role,phone,tg):
        identifier=uuid.uuid4().hex
        with self.store.transaction() as c:
            c.execute("INSERT INTO users(id,name,login,password,role,active,status,phone,telegram_id,telegram_chat,telegram_verified_at,created_at,registered_at,updated_at) VALUES(?,?,?,'!disabled',?,1,'active',?,?,?,?,?,?,?)",(identifier,name,'fixture:'+identifier,role,phone,str(tg),str(tg),self.clock[0],stamp(),stamp(),stamp()))
            for p in ADMIN if role=='admin' else EMPLOYEE:c.execute('INSERT INTO access_permissions VALUES(?,?)',(identifier,p))
        client=self.client();r=self.login(client,phone)
        return client,identifier,{'X-CSRF-Token':r.json['csrf']}
    def login(self,client,phone):
        self.clock[0]+=61
        r=client.post('/api/auth/request-code',json={'phone':phone})
        assert r.status_code==200,r.json
        r=client.post('/api/auth/verify',json={'phone':phone,'code':self.codes[-1][1]['code']})
        assert r.status_code==200,r.json
        return r
    def post(self,client,path,body,headers):return client.post('/api'+path,json=body,headers=headers)
    def patch(self,client,path,body,headers):return client.patch('/api'+path,json=body,headers=headers)
