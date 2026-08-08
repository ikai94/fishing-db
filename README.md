# Fishing Database

Веб-приложение для совместной базы уловов игры «Русская рыбалка».

Phase 2 добавляет пользователей и browser-аутентификацию: email, nickname, пароль, серверные
сессии PostgreSQL и HttpOnly cookie. Игровой каталог и отчёты об уловах пока не реализованы.

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

Unit-тесты не изменяют базу данных. Auth e2e используют отдельный PostgreSQL на порту `5433`;
они консервативно требуют отдельное имя тестовой БД и повторяют safety-check прямо перед
очисткой. Это защищает development-данные даже при алиасах хоста вроде `localhost`/`127.0.0.1`.

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

## Команды базы данных

```powershell
pnpm db:up
pnpm db:down
pnpm db:logs
pnpm db:generate
pnpm db:migrate:dev -- --name migration_name
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:studio
pnpm db:test:up
pnpm db:test:down
```

Изменения Prisma-схемы должны оформляться миграциями. Не используйте автоматический reset или
`prisma db push` как штатный способ изменения базы.
