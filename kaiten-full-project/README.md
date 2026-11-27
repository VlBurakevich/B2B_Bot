# Kaiten и общий Telegram-бот — полный комплект

Состояние: 27.11.2026. Это исходники и конфигурация для программиста. Этот архив ничего не устанавливал на действующие серверы. Он заменяет ранее выданные отдельные ZIP и пример с `B2B_API_PROTOCOL=1`.

## Как устроен запуск

Один существующий Telegram-бот обслуживает B2B и Kaiten. Токен Telegram остаётся прежним. В Compose есть ровно один сервис `bot`, который запускает `node common.mjs` и получает Telegram updates. Контейнер `kaiten-notifications` отправляет уведомления через общий бот и НЕ получает updates.

Телефонная регистрация B2B уже установлена 27.11.2026 и проверена реальным входом. Поэтому здесь **B2B_API_PROTOCOL=2**. Не переключать его на 1. Текущие TELEGRAM_TOKEN, TELEGRAM_USERNAME, B2B_ORIGIN и B2B BRIDGE_KEY сохраняются. У Kaiten отдельный HMAC-ключ; это не Telegram-токен.

Сейчас Kaiten расположен на VPS pulse-operators, а бот — на другом сервере. Compose объединяет контейнеры на одном Docker-хосте; он не переносит приложение между этими серверами.

- **Текущая схема, два сервера:** корневой `docker-compose.yml` обновляет общий бот и его Caddy; `deploy/kaiten-vps/` содержит конфигурацию кандидата Kaiten на прежнем VPS. Переносить сайт к боту не требуется.
- **Дополнительный вариант, один сервер:** корневой Compose + `docker-compose.with-kaiten.yml` запускают bot, caddy, kaiten и kaiten-notifications в одном проекте. Для этого нужен отдельный согласованный перенос данных Kaiten и DNS на хост бота. Самостоятельно такой перенос не выполнялся.

## Что внутри

- `bot/` — полный общий бот, Dockerfile, тесты и `.env`.
- `kaiten/` — полный исходный код Kaiten с интерфейсом в стиле Todoist, телефонным входом, правами, файлами, миграцией и тестами; `.env` рядом с кодом.
- Корневые `docker-compose.yml`, `Caddyfile`, `.env` — обновление существующего сервера бота.
- `docker-compose.with-kaiten.yml`, `Caddyfile.with-kaiten` — необязательный вариант одного хоста.
- `deploy/kaiten-vps/` — кандидат на отдельном порту 18088 и точечные изменения виртуального хоста тестового сайта.
- `scripts/prepare_env.py` — перенос прежних секретов бота и подготовка одинакового независимого ключа Kaiten в двух `.env`.
- `scripts/check_env.py` — офлайн-проверка согласованности конфигурации.

B2B-веб-приложение остаётся действующим; его код и база в этот архив не включены и не меняются.

## Файлы окружения

Все `.env` в поставке — заполненные адресами шаблоны. Реальных токенов, ключей, баз, вложений и первоначального ключа руководителя здесь нет. Копии шаблонов также находятся в `.env.example`.

| Файл | Для чего |
|---|---|
| `.env` | Имя существующего Compose-проекта, домен бота и реальные имена существующих Docker-томов |
| `bot/.env` | Прежний Telegram-токен и B2B-ключ; новый независимый ключ тестового Kaiten |
| `kaiten/.env` | URL тестового Kaiten и тот же Kaiten-ключ; Telegram-токена здесь нет |
| `deploy/kaiten-vps/.env` | Отдельный каталог данных кандидата и его локальный порт |

Из корня архива на сервере бота:

```sh
python3 scripts/prepare_env.py --existing-bot-env /ABSOLUTE/PATH/TO/CURRENT/bot/.env
```

Скрипт сохраняет прежние Telegram-токен, B2B-ключ и дополнительные настройки из текущего файла. При первом запуске создаёт отдельный случайный ключ Kaiten, при повторном сохраняет его. Записывает согласованные `bot/.env` и `kaiten/.env` с правами 0600, делает приватные резервные копии; секреты не выводит. Если ключи уже расходятся — останавливается до записи. Это подготовка файлов, а не установка или рестарт.

Для схемы двух серверов полученный `kaiten/.env` передать на VPS Kaiten защищённым способом. Реальный `bot/.env` с Telegram-токеном остаётся только на сервере бота; на VPS достаточно его незаполненного шаблона. Не присылать ключи в чат. Для будущего основного `kaiten` нужен ещё один независимый ключ и отдельный service ID; этот комплект активирует только `kaiten-test`.

В корневом `.env` указать существующий `COMPOSE_PROJECT_NAME` и имена трёх существующих томов. Узнать их в каталоге текущего Compose-проекта через `docker compose ls`, `docker compose ps` и `docker inspect` контейнеров bot/caddy (смотреть только Mounts и Compose labels). В Compose тома объявлены external, чтобы опечатка не создала новую пустую базу бота или хранилище сертификатов.

```sh
python3 scripts/check_env.py --layout bot-only
docker compose config --quiet
```

`docker compose config` без `--quiet` может вывести секреты; не прикладывать такой вывод в переписку.

## Обновление существующего сервера бота

1. Сохранить текущие код, Compose, Caddyfile, `.env`, состояние/том бота и тома Caddy. Записать текущие имя проекта, тома, образ и команду запуска. Обновлять существующий сервис, а не запускать второй poller в новом проекте.
2. Подготовить окружение как выше. Сверить том bot_state с прежним. Новая копия базы бота не нужна — монтируется его прежний том в `/app/data`, владелец UID/GID 10001 сохранён.
3. Перенести исходники `bot/` и обновлённые конфиги в рабочий каталог существующего проекта либо сохранить его имя и все реальные mount paths. Если Caddy обслуживает другие домены — влить только блок бота/новые пути в действующий Caddyfile, сохранив остальные сайты.
4. В корневом Caddyfile сохранены `/bridge/code`, `/bridge/health`, `/bridge/notify`; добавлены только `/bridge/kaiten-test/{code,health,notify}` к тому же `bot:3103`. Отдельный процесс или порт для Kaiten-канала бота не создаётся.
5. Проверить конфигурацию, собрать бот, остановить прежний bot и заменить его тем же сервисом. Пример для согласованного существующего проекта:

```sh
docker compose config --quiet
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose build bot
docker compose stop bot
docker compose up -d --no-deps bot
docker compose up -d --no-deps caddy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Эти команды применимы, если именно этот Compose управляет действующим bot/caddy и остальные Caddy-блоки уже сохранены в файле. Для отдельного/системного Caddy использовать его действующую процедуру проверки и reload; второй Caddy на 80/443 не запускать.

6. Проверить отсутствие второго poller, ошибки getUpdates 409 и доступность прежнего B2B. Повторить реальный вход B2B. Его подписанный health должен оставаться protocol=2, registration=true. Новый подписанный health `/bridge/kaiten-test/health` возвращает protocol=3, service=kaiten-test, origin=https://test-kaiten.n-smena.business. Неподписанный запрос ожидаемо получает 401.

Новый бот отказывается перезаписывать существующий webhook. Если он обнаружен, остановиться и сверить фактическую архитектуру; не удалять его автоматически. При конфликте poller новый процесс завершается.

## Подключение Kaiten на прежнем VPS

Телефонный backend в `kaiten/` — кандидат. Публичный тестовый сайт сейчас использует новый визуальный интерфейс с прежней авторизацией. Не заменять рабочий backend до готовности бота и подтверждения контакта владельца.

1. Согласовать короткое окно обслуживания **тестового** сайта. Сделать резервную копию `/var/lib/kaiten-test`, кода `/opt/kaiten-test`, окружения и Caddyfile. Остановить только прежний тестовый сервис `kaiten-test`, чтобы во время копирования и подтверждения контакта база не расходилась. Основной `kaiten` и соседние проекты не трогать.
2. Скопировать тестовые данные в отдельный каталог кандидата. Базу, uploads и имеющийся phone-auth.key копировать вместе. Не подключать кандидат к живому каталогу прежнего процесса: при первом старте он мигрирует данные и отзывает старые сессии/приглашения. Архив не содержит рабочих данных или демобазы.
3. Подготовить права **копии** для UID/GID 10001 контейнера. Заполнить `deploy/kaiten-vps/.env`; каталог обязан уже существовать и содержать `focus.sqlite3`. Порт по умолчанию 18088, чтобы не занимать прежний 8088. При изменении порта поправить два Caddy-фрагмента.

```sh
python3 scripts/check_env.py --layout kaiten-vps
docker compose --env-file deploy/kaiten-vps/.env -f deploy/kaiten-vps/docker-compose.yml config --quiet
docker compose --env-file deploy/kaiten-vps/.env -f deploy/kaiten-vps/docker-compose.yml up -d --build kaiten
```

4. В действующем Caddy VPS заменить только блок тестового домена на `Caddyfile.registration.fragment`, предварительно сохранив оригинал и проверив конфиг. Подписанная регистрация пойдёт кандидату, остальной сайт временно покажет обслуживание. Основной домен не меняется.
5. Владелец в общем боте выбирает «Kaiten · тест», отправляет **собственный** контакт и ФИО. После подтверждения оператор связывает эту личность с точным ID его существующего тестового аккаунта руководителя:

```sh
docker compose --env-file deploy/kaiten-vps/.env -f deploy/kaiten-vps/docker-compose.yml exec kaiten python identity.py --account-id EXISTING_ID --telegram-id VERIFIED_TG_ID --phone +7XXXXXXXXXX
docker compose --env-file deploy/kaiten-vps/.env -f deploy/kaiten-vps/docker-compose.yml exec kaiten python identity.py --account-id EXISTING_ID --telegram-id VERIFIED_TG_ID --phone +7XXXXXXXXXX --apply
```

Сначала просмотр, затем явная привязка. Совпадение имени не используется. Первый руководитель не создаётся заново; его ID, проекты и задачи сохраняются.

6. После проверки привязки и прав первого руководителя заменить только тестовый Caddy-блок на `Caddyfile.cutover.fragment`, проверить и reload. Запустить `kaiten-notifications` тем же Compose-файлом. Проверить реальный вход, заявку сотрудника, выдачу прав, отзыв сессии и блокировку. Коды вводит их владелец.
7. Основной сайт переносится на телефонный вход отдельным этапом после проверки тестового; нужны свежая копия его актуальной базы, отдельный ключ и привязка его существующего руководителя. Демобаза/старая тестовая копия не заменяет production.

## Если всё нужно в одном Compose на одном хосте

Этот вариант не нужен для текущих двух серверов. До запуска согласовать перенос тестового Kaiten на хост бота, копирование актуальных данных и изменение DNS; сначала проверить права первого руководителя в кандидате. Копия данных монтируется в `KAITEN_DATA_DIR` из корневого `.env`.

```sh
python3 scripts/check_env.py --layout single-host
docker compose -f docker-compose.yml -f docker-compose.with-kaiten.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.with-kaiten.yml up -d --build kaiten
```

На переключении после подготовки DNS, TLS и аккаунта:

```sh
docker compose -f docker-compose.yml -f docker-compose.with-kaiten.yml up -d --no-deps caddy
docker compose -f docker-compose.yml -f docker-compose.with-kaiten.yml exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f docker-compose.yml -f docker-compose.with-kaiten.yml up -d kaiten-notifications
```

Overlay заменяет только mount `/etc/caddy/Caddyfile` на вариант `Caddyfile.with-kaiten`, добавляет два контейнера приложения и не создаёт второго bot. Если на том Caddy есть другие сайты, их блоки нужно сохранить и в этом варианте файла. Основной `kaiten.n-smena.business` в этом варианте тоже не активирован.

## Проверки и откат

```sh
python3 -m unittest discover -s tests -v
PYTHONPATH=kaiten python3 -m unittest discover -s kaiten/tests -v
node --test bot/test/*.test.mjs
node --check kaiten/static/app.js
```

Локальные тесты подменяют Telegram; наличие тестов не означает выполненную реальную доставку. Docker/Caddy-команды проверять установленными инструментами целевого сервера. Реальные токены не нужны для unit-тестов.

При откате бота остановить новый poller, вернуть прежние код, окружение и том из согласованной резервной копии; затем запустить один прежний bot и проверить B2B. При откате тестового Kaiten вернуть прежний Caddy-блок и прежний тестовый сервис с его нетронутой базой. После записи новых данных в кандидат откат с сохранением этих данных требует отдельного переноса, а не подмены устаревшей базы. Не выполнять `docker compose down -v`.

Справка по конфигурации: [Compose merge](https://docs.docker.com/reference/compose-file/merge/), [external volumes](https://docs.docker.com/reference/compose-file/volumes/), [Caddy validate](https://caddyserver.com/docs/command-line#caddy-validate).
