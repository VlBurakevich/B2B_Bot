"""B2B-only deployment. Never reads or modifies the operator service."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, sqlite3, subprocess, time, urllib.request
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--env-file',required=True);a=p.parse_args()
base=Path(__file__).resolve().parent;current=Path('/opt/b2b-control/current');old=current.resolve();dbpath=Path('/var/lib/b2b-control/b2b.sqlite');node='/usr/local/bin/node'
for name,digest in json.loads((base/'baseline.json').read_text()).items():
 assert hashlib.sha256((old/name).read_bytes()).hexdigest()==digest,'Baseline changed: '+name
# Existing env stays on the server; do not print or package secrets.
subprocess.run([node,'--env-file='+a.env_file,str(base/'check-bot.mjs')],check=True)
db=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True)
assert db.execute("SELECT COUNT(*) FROM users u JOIN account_permissions p ON p.user_id=u.id JOIN telegram_members t ON t.user_id=u.id WHERE u.state='active' AND p.permission='accounts.manage' AND t.phone IS NOT NULL AND t.telegram_id IS NOT NULL").fetchone()[0]>0,'No admin with verified Telegram; refusing lockout'
print(json.dumps({'preflight':'ok','active_users_without_phone':db.execute("SELECT COUNT(*) FROM users u LEFT JOIN telegram_members t ON t.user_id=u.id WHERE u.state='active' AND t.phone IS NULL").fetchone()[0]}));db.close()
if not a.apply:raise SystemExit(0)
tag=time.strftime('phone-access-%Y%m%dT%H%M%SZ',time.gmtime());release=Path('/opt/b2b-control/releases')/tag;backup=Path('/var/backups/b2b-control')/tag
backup.mkdir(mode=0o700);(backup/'previous-release.txt').write_text(str(old));shutil.copytree(old,release,symlinks=True)
for source in (base/'service').rglob('*'):
 if not source.is_file() or 'test' in source.parts or source.suffix not in ('.js','.mjs','.json','.css','.html','.svg'):continue
 target=release/source.relative_to(base/'service');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);target.chmod(0o644)
 if target.suffix in ('.js','.mjs'):subprocess.run([node,'--check',str(target)],check=True,capture_output=True)
# The removed password pages and helper must not remain in a copied release.
for name in ['public/reset-password.html','public/reset-password.js','issue-reset.mjs']:(release/name).unlink(missing_ok=True)
subprocess.run(['systemctl','stop','b2b-control'],check=True)
try:
 db=sqlite3.connect(str(dbpath));dst=sqlite3.connect(str(backup/'b2b.sqlite'));db.backup(dst);dst.close();db.close();(backup/'b2b.sqlite').chmod(0o600)
 temp=current.with_name('current.phone-next');temp.symlink_to(release);os.replace(temp,current);subprocess.run(['systemctl','start','b2b-control'],check=True)
 for attempt in range(15):
  try:
   me=json.loads(urllib.request.urlopen('http://127.0.0.1:3102/api/auth/me',timeout=3).read());assert me['user'] is None and me['telegram']['username']=='nashasmena_b2b_login_bot';break
  except Exception:time.sleep(1)
 else:raise RuntimeError('Phone-auth health check failed')
 db=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True);assert db.execute("SELECT value FROM access_schema WHERE key='v1'").fetchone()==('1',);db.close()
 print(json.dumps({'ok':True,'release':str(release),'backup':str(backup),'next':'Verify one real Telegram login and admin Access page'}))
except Exception:
 # Roll back code, not live business data. Additive tables are compatible with the previous release.
 temp=current.with_name('current.phone-rollback');temp.symlink_to(old);os.replace(temp,current);subprocess.run(['systemctl','restart','b2b-control'],check=True);raise
