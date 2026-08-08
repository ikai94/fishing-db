# Fishing Database

Инфраструктурный каркас веб-приложения для совместной базы уловов игры «Русская рыбалка».

Phase 1 содержит только Next.js frontend, NestJS API, PostgreSQL и Prisma. Пользователи,
авторизация, игровой каталог и отчёты об уловах пока не реализованы.

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

3. Запустите PostgreSQL и дождитесь статуса `healthy`:

```powershell
pnpm db:up
docker compose ps
```

4. Сгенерируйте Prisma Client:

```powershell
pnpm db:generate
```

В Phase 1 Prisma-схема намеренно не содержит моделей, поэтому миграций пока нет.

5. Запустите frontend и API одной командой:

```powershell
pnpm dev
```

Откройте:

- frontend: http://localhost:3000
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

## Команды базы данных

```powershell
pnpm db:up
pnpm db:down
pnpm db:logs
pnpm db:generate
pnpm db:migrate:dev -- --name migration_name
pnpm db:migrate:deploy
pnpm db:studio
```

Изменения Prisma-схемы должны оформляться миграциями. Не используйте автоматический reset или
`prisma db push` как штатный способ изменения базы.
