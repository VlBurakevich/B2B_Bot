import json,unittest
from telegram_bridge import signature,BridgeClient
from access import AccessError
class Response:
    status=200
    def __init__(self,payload):self.payload=payload
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,*args):return json.dumps(self.payload).encode()
class Opener:
    def __init__(self,health):self.health=health;self.calls=[]
    def open(self,req,timeout):
        self.calls.append(req)
        return Response(self.health if req.full_url.endswith('/health') else {'ok':True})
class BridgeProtocolTest(unittest.TestCase):
    def test_python_hmac_matches_node_utf8_vector(self):
        self.assertEqual(signature('22'*32,'kaiten-test','1800000000','ab'*16,'/bridge/kaiten-test/code','{"message":"Привет","code":"123456"}'.encode()),'143c36252a254f53b568f635740f6189729c1ff3f653ab9388e0dc4ff3ed48a1')
    def test_old_bot_protocol_or_wrong_origin_cannot_receive_kaiten_code(self):
        for health in [{'ok':True,'protocol':2,'registration':True},{'ok':True,'protocol':3,'registration':True,'service':'kaiten-test','origin':'https://b2b.test'}]:
            opener=Opener(health);client=BridgeClient('https://bot.test','22'*32,'kaiten-test','https://kaiten.test',opener=opener)
            with self.assertRaises(AccessError):client.send('code',{'code':'123456'})
            self.assertEqual(len(opener.calls),1)
    def test_matching_service_uses_separate_kaiten_endpoint(self):
        opener=Opener({'ok':True,'protocol':3,'registration':True,'service':'kaiten-test','origin':'https://kaiten.test'})
        client=BridgeClient('https://bot.test','22'*32,'kaiten-test','https://kaiten.test',opener=opener)
        self.assertEqual(client.send('code',{'code':'123456'}),{'ok':True})
        self.assertEqual(opener.calls[-1].full_url,'https://bot.test/bridge/kaiten-test/code')
        self.assertIn(('X-kaiten-service','kaiten-test'),opener.calls[-1].header_items())

if __name__=='__main__':unittest.main()
