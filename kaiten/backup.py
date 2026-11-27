"""Read-only backup of SQLite, attachments and the auth key. Stop writers for file consistency."""
import os
import secrets
import sqlite3
import sys
import tarfile
import tempfile
from contextlib import closing
from pathlib import Path
from datetime import datetime

def backup(data,destination):
    data,destination=Path(data).resolve(),Path(destination).resolve()
    database=data/'focus.sqlite3'
    if not database.is_file():raise RuntimeError('Specify an existing DATA_DIR; database was not created')
    destination.mkdir(mode=0o700,parents=True,exist_ok=True)
    filename=destination/('kaiten-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(4)+'.tar.gz')
    fd=os.open(filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
    try:
        with tempfile.TemporaryDirectory() as folder:
            copied=Path(folder)/'focus.sqlite3'
            with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=15)) as source,closing(sqlite3.connect(copied)) as target:source.backup(target)
            with tarfile.open(filename,'w:gz') as archive:
                archive.add(copied,arcname='focus.sqlite3')
                if (data/'uploads').is_dir():archive.add(data/'uploads',arcname='uploads')
                if (data/'phone-auth.key').is_file():archive.add(data/'phone-auth.key',arcname='phone-auth.key')
        return filename
    except Exception:
        filename.unlink(missing_ok=True);raise

if __name__=='__main__':
    data=Path(os.environ.get('DATA_DIR',str(Path(__file__).resolve().parent/'data'))).resolve()
    print(backup(data,sys.argv[1] if len(sys.argv)>1 else data/'backups'))
