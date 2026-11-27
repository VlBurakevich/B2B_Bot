import {createInterface} from 'node:readline/promises';
import {join} from 'node:path';
import {openStore} from './store.mjs';
import {setupTelegram,assignPhone} from './telegram-auth.mjs';
if(!process.env.B2B_DATA_DIR)throw Error('Задайте B2B_DATA_DIR.');
const store=openStore(join(process.env.B2B_DATA_DIR,'b2b.sqlite'));
const cli=createInterface({input:process.stdin,output:process.stdout});
try{
  setupTelegram(store.db);
  const login=(await cli.question('Логин существующего сотрудника B2B: ')).trim().toLowerCase();
  const user=store.db.prepare("SELECT id,name FROM users WHERE login=? AND state='active'").get(login);
  if(!user)throw Error('Активный аккаунт не найден.');
  const phone=await cli.question('Номер телефона сотрудника (+7…): ');
  const confirm=await cli.question(`Привязать номер к аккаунту «${user.name}»? Введите ДА: `);
  if(confirm==='ДА'){assignPhone(store.db,user.id,phone);console.log('Номер назначен. Сотруднику нужно подтвердить свой контакт в боте.');}
  else console.log('Изменения отменены.');
}finally{cli.close();store.db.close();}
