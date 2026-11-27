import os,sqlite3,tarfile,tempfile,unittest
from pathlib import Path
from contextlib import closing
from backup import backup
class BackupTest(unittest.TestCase):
    def test_backup_is_private_and_does_not_migrate_legacy_database(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)/'old';data.mkdir();(data/'uploads').mkdir();(data/'uploads/a').write_bytes(b'file');(data/'phone-auth.key').write_bytes(b'x'*32)
            with closing(sqlite3.connect(data/'focus.sqlite3')) as c,c:
                c.execute('CREATE TABLE users(id TEXT)');c.execute("INSERT INTO users VALUES('old')")
            archive=backup(data,Path(folder)/'backups')
            self.assertEqual(archive.stat().st_mode&0o777,0o600)
            with tarfile.open(archive) as t:self.assertEqual(set(t.getnames()),{'focus.sqlite3','uploads','uploads/a','phone-auth.key'})
            with closing(sqlite3.connect(data/'focus.sqlite3')) as c:
                self.assertEqual([r[1] for r in c.execute('PRAGMA table_info(users)')],['id'])
                self.assertEqual(c.execute('SELECT count(*) FROM users').fetchone()[0],1)
if __name__=='__main__':unittest.main()
