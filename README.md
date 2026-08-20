# Fishing Database

Веб-приложение для совместной базы уловов игры «Русская рыбалка».

Phase 2 добавляет пользователей и browser-аутентификацию: email, nickname, пароль, серверные
сессии PostgreSQL и HttpOnly cookie. Phase 3 добавляет публичный игровой каталог и защищённое
ADMIN-управление базами, локациями, рыбами и наживками. Phase 4 добавляет публичные
структурированные отчёты об уловах, ручной ввод и личный список. Phase 5 переносит связь рыбы на уровень
FishingBase, добавляет экранные ориентиры, каталожный seed Амура и уточнённую модель отчёта.

## Требуемое программное обеспечение

- Node.js `24.19.0` (ветка Node.js 24 LTS);
- pnpm `11.20.0`;
- Docker Desktop с Docker Compose;
- Git.

Проверка версий в PowerShell:

```powershell
node --version
pnpm --version
docker compose version
```

Если pnpm ещё не активирован, выполните один раз:

```powershell
corepack enable
corepack prepare pnpm@11.20.0 --activate
```

Если PowerShell сообщает об отсутствии прав на `corepack enable`, запустите эту команду один
раз в PowerShell от имени администратора.

## Первый запуск в Windows PowerShell

Все команды выполняются из корня репозитория.

1. Установите зависимости:

```powershell
pnpm install
```

2. Создайте локальные файлы окружения из примеров:

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

Корневой `.env` используется Docker Compose. `apps/api/.env` используется NestJS и Prisma.
`apps/web/.env.local` задаёт публичный адрес API для браузера. При изменении логина, пароля,
порта или имени базы в корневом `.env` синхронно обновите `DATABASE_URL` в `apps/api/.env`.
Production-сборка требует явно заданный `NEXT_PUBLIC_API_URL`; localhost fallback доступен
только в development.

3. Запустите PostgreSQL и дождитесь статуса `healthy`:

```powershell
pnpm db:up
docker compose ps
```

4. Примените существующие миграции и сгенерируйте Prisma Client:

```powershell
pnpm db:migrate:deploy
pnpm db:generate
```

5. Запустите frontend и API одной командой:

```powershell
pnpm dev
```

Откройте:

- frontend: http://localhost:3000
- регистрация: http://localhost:3000/register
- вход: http://localhost:3000/login
- аккаунт: http://localhost:3000/account
- базы: http://localhost:3000/bases
- рыбы: http://localhost:3000/fish
- наживки и приманки: http://localhost:3000/baits
- публичные уловы: http://localhost:3000/catches
- добавить улов: http://localhost:3000/catches/new
- мои уловы: http://localhost:3000/my/catches
- ADMIN-каталог: http://localhost:3000/admin/catalog
- API health: http://localhost:3001/api/v1/health

Проверить health endpoint из PowerShell можно так:

```powershell
Invoke-RestMethod http://localhost:3001/api/v1/health |
  ConvertTo-Json -Depth 5
```

Ожидаемый ответ при работающей базе:

```json
{
  "status": "ok",
  "application": "up",
  "database": "up",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Для остановки Next.js и NestJS нажмите `Ctrl+C`. PostgreSQL останавливается отдельно:

```powershell
pnpm db:down
```

Команда `db:down` сохраняет named volume и данные PostgreSQL.

## Раздельный запуск приложений

```powershell
pnpm dev:web
pnpm dev:api
```

Эти команды следует выполнять в отдельных окнах PowerShell. Перед `dev:api` PostgreSQL должен
быть запущен. Команда автоматически генерирует Prisma Client.

## Проверки проекта

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Или все проверки последовательно:

```powershell
pnpm check
```

Unit-тесты не изменяют базу данных. Auth, catalog и CatchReport e2e последовательно используют
отдельный PostgreSQL на порту `5433`; они консервативно требуют отдельное имя тестовой БД и
повторяют safety-check прямо перед очисткой. Это защищает development-данные даже при алиасах
хоста вроде `localhost`/`127.0.0.1`.

Подготовка e2e в Windows PowerShell:

```powershell
Copy-Item apps/api/test/.env.example apps/api/test/.env
pnpm db:test:up

$env:DATABASE_URL = 'postgresql://fishing_test:fishing_test_password@localhost:5433/fishing_db_test'
pnpm db:migrate:deploy
Remove-Item Env:DATABASE_URL

pnpm test:e2e
```

После тестов test-сервис можно остановить:

```powershell
pnpm db:test:down
```

## Аутентификация

API предоставляет только четыре auth endpoint:

- `POST /api/v1/auth/register`;
- `POST /api/v1/auth/login`;
- `POST /api/v1/auth/logout`;
- `GET /api/v1/auth/me`.

Frontend отправляет auth-запросы с `credentials: 'include'`. Сырой session token хранится только
в cookie `fishing_session` с `HttpOnly`, `SameSite=Lax`, `Path=/`; в PostgreSQL сохраняется только
его SHA-256 hash. В production cookie дополнительно получает `Secure`.

Изменяющие запросы принимаются только от точного `WEB_ORIGIN` по заголовку `Origin` или по
валидному `Referer`, если `Origin` отсутствует.

Разрешены только email с доменом, оканчивающимся на `.ru`. Email сохраняется после `trim` и
lowercase; nickname сохраняет отображаемый регистр, а уникальность проверяется по отдельному
нормализованному значению.

## Игровой каталог

Публичные active-only endpoints доступны без авторизации:

- `GET /api/v1/catalog/bases`;
- `GET /api/v1/catalog/bases/:baseId`;
- `GET /api/v1/catalog/locations/:locationId`;
- `GET /api/v1/catalog/fish`;
- `GET /api/v1/catalog/fish/:fishId`;
- `GET /api/v1/catalog/baits`;
- `GET /api/v1/catalog/screen-anchors`.

Список баз возвращает для каждой active Base число active Locations и active Fish.
Fish detail возвращает только active связанные Bases; active Fish без связей
имеет пустой список `bases`.

Frontend-страницы каталога находятся на `/bases`, `/bases/:id`, `/locations/:id`, `/fish`,
`/fish/:id` и `/baits`. Неактивные сущности остаются в PostgreSQL для будущих исторических
ссылок, но не выдаются публичным API.

Управление выполняется только через `/api/v1/admin/catalog/...`. Каждый ADMIN endpoint сначала
проверяет server-side Session, затем роль и ban status. Обычный USER получает 403, а banned ADMIN
не получает доступ даже к административному чтению. Наличие или отсутствие frontend-кнопки не
является проверкой прав.

Для `FishingBase`, `Location`, `Fish`, `Bait` и `ScreenAnchor` нет штатных hard-delete endpoints:
lifecycle управляется полем `isActive`. Строку `FishingBaseFish` ADMIN может добавить и физически
удалить, поскольку CatchReport ссылается отдельно на Location и Fish. Рыба, связанная с базой,
теоретически доступна на всех её локациях; Fish×Location-строки не создаются.

Каталожные названия сохраняют отображаемый регистр и пунктуацию. Отдельный ключ уникальности
формируется через внешний trim, NFKC, схлопывание Unicode-пробелов и lowercase; `е` и `ё` не
объединяются.

## Отчёты об уловах

Публичные endpoints доступны без авторизации:

- `GET /api/v1/catch-reports`;
- `GET /api/v1/catch-reports/statistics/holes`;
- `GET /api/v1/catch-reports/:reportId`.

Лента использует cursor pagination по `createdAt DESC, id DESC`; поддерживаются `limit=1..100` и
opaque `cursor`. Публичная лента также принимает optional `fishId=<uuid-v4>` и
`baseIds=<uuid-v4>,<uuid-v4>,...` (от 1 до 100 уникальных ID). База фильтруется через
`CatchReport -> Location -> FishingBase`; пустой или malformed `baseIds` возвращает 400, а
отсутствующий `baseIds` не добавляет Base filter. Ответ содержит `items` и `nextCursor`, без
total count и номеров страниц. Эти фильтры не принимаются owner endpoint
`GET /api/v1/me/catch-reports`.

Статистика общих ям требует `fishId=<uuid-v4>` и
`baseIds=<uuid-v4>,<uuid-v4>,...` (1–100 уникальных ID). Группа определяется точными
Location и глубиной в сантиметрах вместе с консервативно нормализованной
позицией; отчёты без глубины не участвуют. Ответ разделяет число отчётов и
уникальных рыбаков, не возвращая их личности, заметки или исходный текст.
Исторические отчёты продолжают участвовать после деактивации каталога, удаления
текущей связи Fish–Base или блокировки автора.

Изменения требуют Session и незаблокированный аккаунт:

- `POST /api/v1/catch-reports`;
- `PATCH /api/v1/catch-reports/:reportId`;
- `DELETE /api/v1/catch-reports/:reportId`.

`GET /api/v1/me/catch-reports` и `GET /api/v1/me/catch-reports/:reportId` требуют только Session
и остаются доступными заблокированному пользователю для чтения. Detail владельца содержит
owner-only `rawSourceText`; публичные list/detail никогда его не возвращают. Владелец всегда
определяется backend по Session cookie; `userId`, `fishingBaseId` и `fishingMethod` не принимаются
из запроса.

Вес хранится целыми граммами, глубина — nullable целыми сантиметрами. Исторический метод
`BAIT_FISHING`/`SPINNING` backend выводит из активной выбранной наживки и сохраняет в отчёте.
Для ловли на наживку обязательна положительная глубина; для спиннинга обязательны размер и
скорость проводки, а глубина остаётся опциональной. `spotPositionRaw`, условие ловли и публичный
`userNoteRaw` («Комментарий») хранятся раздельно. Подтверждённая строка блокнота сохраняется
точно в owner-only `rawSourceText` и недоступна через PATCH.

При создании проверяется текущее активное состояние Location/Base/Fish/Bait и наличие
FishingBaseFish для базы выбранной Location. После создания отчёт является историческим:
деактивация каталога, удаление FishingBaseFish или блокировка автора не скрывают его. При
редактировании текущий каталог повторно проверяется только для действительно изменённых ссылок;
повторная отправка того же `baitId` не переклассифицирует сохранённый метод.

`POST /api/v1/catch-reports/parse` доступен любому аутентифицированному пользователю, включая
заблокированного, возвращает только неперсистентный редактируемый Draft и не создаёт CatchReport.
Сохранение после preview выполняется обычным `POST /api/v1/catch-reports`, поэтому banned-проверка
и вся серверная валидация применяются повторно. Неоднозначные фрагменты сохраняются в Draft как
WARNING; BLOCKING-проблемы запрещают подтверждение.

## Первый ADMIN

ADMIN создаётся или повышается только явной командой. Не храните настоящие credentials в Git:

```powershell
$env:ADMIN_EMAIL = 'admin@example.ru'
$env:ADMIN_NICKNAME = 'Administrator'
$env:ADMIN_PASSWORD = '<длинный уникальный пароль>'
pnpm db:seed
```

Если пользователь с таким email уже существует, seed меняет только его роль на `ADMIN` и не
сбрасывает nickname, password, ban status или активные сессии. Повторный запуск безопасен.

## Реальный игровой каталог

Отдельная явная команда добавляет полный статический игровой каталог: 77 баз,
853 локации, 1255 глобальных рыб, 5369 связей FishingBase–Fish, 249 наживок и
приманок (68 `BAIT`, 181 `LURE`) и 8 экранных ориентиров:

```powershell
pnpm db:seed:catalog
```

Seed работает полностью offline: сначала валидирует канонические файлы и контрольные количества, затем
выполняет одну транзакцию. Он повторно использует существующие нормализованные сущности, не переименовывает, не
реактивирует, не деактивирует и не удаляет ручные/посторонние строки. Совпавшая неактивная строка остается
неактивной. Несовпадение `Bait.type` или другой семантический конфликт откатывает всю транзакцию.
Повторный запуск не создает новых строк.

Контрольные числа относятся к реальному каталогу. Абсолютные totals в development DB могут быть выше из-за
сохраняемых tutorial/custom-строк. `db:seed:catalog` не входит в `test`, `test:e2e` или `check`; ADMIN-bootstrap по-прежнему
запускается отдельно через `pnpm db:seed`.

## Команды базы данных

```powershell
pnpm db:up
pnpm db:down
pnpm db:logs
pnpm db:generate
pnpm db:migrate:dev -- --name migration_name
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed:catalog
pnpm db:audit:catch-reports
pnpm db:studio
pnpm db:test:up
pnpm db:test:down
```

Изменения Prisma-схемы должны оформляться миграциями. Не используйте автоматический reset или
`prisma db push` как штатный способ изменения базы.

Для существующей Phase 4 базы с ещё не проверенными историческими CatchReport используйте
[поэтапную maintenance-инструкцию Phase 5](docs/phase5-rollout.md): сначала две compatibility
миграции, затем read-only audit, и только при чистом результате — финальный CHECK.
