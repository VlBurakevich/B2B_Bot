"""Ensure environment handoff cannot rotate B2B credentials or mix service keys."""
import importlib.util
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from prepare_env import prepare,read_values
from check_env import check

class EnvHandoff(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        for directory in ['bot','kaiten']:
            (self.root/directory).mkdir();shutil.copy2(ROOT/directory/'.env.example',self.root/directory/'.env')
        self.old=self.root/'existing.env'
        self.old.write_text('TELEGRAM_TOKEN=123456:fixture_token_not_real\nBRIDGE_KEY='+'11'*32+'\nB2B_ORIGIN=https://b2b.n-smena.business\nEXTRA_KEEP=keep_me\n')
    def tearDown(self):self.tmp.cleanup()
    def test_existing_credentials_and_extra_settings_preserved(self):
        prepare(self.root,self.old)
        bot=read_values(self.root/'bot/.env');app=read_values(self.root/'kaiten/.env')
        self.assertEqual(bot['TELEGRAM_TOKEN'],'123456:fixture_token_not_real');self.assertEqual(bot['BRIDGE_KEY'],'11'*32)
        self.assertEqual(bot['EXTRA_KEEP'],'keep_me');self.assertEqual(bot['B2B_API_PROTOCOL'],'2')
        self.assertEqual(bot['KAITEN_TEST_BRIDGE_KEY'],app['KAITEN_BRIDGE_KEY']);self.assertNotEqual(bot['BRIDGE_KEY'],app['KAITEN_BRIDGE_KEY'])
        self.assertEqual((self.root/'bot/.env').stat().st_mode&0o777,0o600)
    def test_rerun_does_not_rotate_kaiten_key(self):
        prepare(self.root,self.old);before=read_values(self.root/'bot/.env')['KAITEN_TEST_BRIDGE_KEY']
        prepare(self.root,self.old);self.assertEqual(read_values(self.root/'kaiten/.env')['KAITEN_BRIDGE_KEY'],before)
    def test_conflicting_keys_abort_without_writes(self):
        prepare(self.root,self.old);before=(self.root/'bot/.env').read_bytes()
        (self.root/'kaiten/.env').write_text('KAITEN_BRIDGE_KEY='+'22'*32+'\n')
        with self.assertRaises(ValueError):prepare(self.root,self.old)
        self.assertEqual((self.root/'bot/.env').read_bytes(),before)
    def test_legacy_protocol_cannot_silently_replace_live_registration(self):
        self.old.write_text(self.old.read_text()+'B2B_API_PROTOCOL=1\n');before=(self.root/'bot/.env').read_bytes()
        with self.assertRaises(ValueError):prepare(self.root,self.old)
        self.assertEqual((self.root/'bot/.env').read_bytes(),before)
    def test_separate_kaiten_vps_does_not_need_telegram_token(self):
        shutil.copy2(ROOT/'.env.example',self.root/'.env')
        deploy=self.root/'deploy/kaiten-vps';deploy.mkdir(parents=True)
        data=self.root/'candidate-data';data.mkdir();(data/'focus.sqlite3').touch()
        (deploy/'.env').write_text(f'KAITEN_DATA_DIR={data}\n')
        app=self.root/'kaiten/.env';app.write_text(app.read_text().replace('REPLACE_WITH_NEW_KAITEN_TEST_64_HEX_KEY','22'*32))
        check(self.root,'kaiten-vps')
        self.assertIn('REPLACE',read_values(self.root/'bot/.env')['TELEGRAM_TOKEN'])

if __name__=='__main__':unittest.main()
