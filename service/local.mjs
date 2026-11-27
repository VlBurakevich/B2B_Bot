import {existsSync, mkdirSync, chmodSync, renameSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync, backup} from 'node:sqlite';
import {createApp} from './server.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, '..', '.local', 'data');
const database = join(dataDir, 'b2b.sqlite');
const port = Number(process.env.PORT || 3102);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT должен быть числом от 1 до 65535.');
}

mkdirSync(dataDir, {recursive: true, mode: 0o700});
if (!existsSync(database)) {
  const sourceFile = join(root, '..', 'private', 'b2b.sqlite');
  if (!existsSync(sourceFile)) throw new Error('Не найдена исходная база private/b2b.sqlite.');
  const source = new DatabaseSync(sourceFile, {readOnly: true});
  const temporary = database + '.tmp-' + process.pid;
  try {
    await backup(source, temporary);
    chmodSync(temporary, 0o600);
    renameSync(temporary, database);
  } finally {
    source.close();
    rmSync(temporary, {force: true});
  }
  console.log('Создана локальная копия базы заявок.');
}

const origin = 'http://127.0.0.1:' + port;
const app = createApp({dataDir, origin, preview: true, autoSync: false});
app.server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'Порт ' + port + ' уже занят. Укажите другой: PORT=3103 npm run local'
    : error.message);
  app.store.db.close();
  process.exitCode = 1;
});
app.server.listen(port, '127.0.0.1', () => {
  console.log('Локальная версия: ' + origin);
  console.log('Вход без пароля. Данные и комментарии сохраняются только в локальной копии.');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => app.server.close(() => process.exit(0)));
}
