import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,chmodSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const dir='/var/backups/b2b-control';mkdirSync(dir,{recursive:true,mode:0o700});
const db=new DatabaseSync('/var/lib/b2b-control/b2b.sqlite',{readOnly:true}),file=join(dir,'b2b-'+new Date().toISOString().slice(0,10)+'.sqlite');
await backup(db,file);db.close();chmodSync(file,0o600);
const files=readdirSync(dir).filter(f=>/^b2b-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().reverse();for(const old of files.slice(30))unlinkSync(join(dir,old));
