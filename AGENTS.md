# Fishing Database Project

## Project purpose

This project is a web application for players of the Russian Fishing game.

It combines:

1. a public collaborative fishing database;
2. a private fishing archive for every registered user.

Game hierarchy:

Fishing Base -> Location -> Fish.

Users submit catch reports.

A catch report may contain:

- user
- location
- fish
- bait/lure
- fish weight
- fishing hole depth
- location landmark
- fishing condition/note

Example game notebook entry:

"Шамбардия Валберга 40 грамм. Поймана на Озера Танзании: Берег слоновьего бивня, Мотыль. ямка 6,00 удочка"

Game-generated information:

- fish: Шамбардия Валберга
- weight: 40 grams
- fishing base: Озера Танзании
- location: Берег слоновьего бивня
- bait: Мотыль

Player-created information:

- hole depth: 6,00
- landmark: удочка

Another example:

"ямка 7,63 вполводы"

means:

- hole depth: 7.63 meters
- "вполводы" is NOT a location landmark
- it is a fishing condition / presentation note

Never use one generic `hint` field for these concepts.

Prefer separate fields such as:

- holeDepthCm
- spotLandmark
- fishingNote
- userNoteRaw

Always preserve the original user-entered note.

## Common fishing holes

One of the main goals is to identify fishing holes that occur for multiple game accounts.

Raw number of catches and unique number of users are different metrics.

Example:

User A reports the same hole 100 times.
Users B, C and D report another hole once each.

The second hole has more independent confirmations.

Statistics must therefore distinguish:

- reportsCount
- uniqueUsersCount

For common-hole statistics, uniqueUsersCount is especially important.

Do not use fishing conditions such as "вполводы" as part of a fishing hole identity.

A hole identity may eventually use:

- locationId
- holeDepthCm
- normalized spotLandmark

Do not aggressively merge uncertain holes.

## Public and private data

Game catalog is public and maintained by administrators.

Catalog includes:

- FishingBase
- Location
- Fish
- Bait/Lure
- relations between them

Normal users cannot modify the game catalog.

Users can submit public catch reports.

Users also have a strictly private personal database.

Private user notes must never be exposed through another user's API requests.

## Technology

Use:

- TypeScript
- Node.js
- Next.js
- NestJS
- PostgreSQL
- Prisma
- pnpm
- Docker Compose

Use a monorepo.

Target structure:

apps/web
apps/api
packages/shared
docs

Use REST between frontend and backend.

Use PostgreSQL as the source of truth.

## Architecture

Prefer a modular monolith.

Do NOT introduce unless explicitly requested:

- microservices
- Kafka
- RabbitMQ
- Kubernetes
- GraphQL
- Elasticsearch
- Redis

Do not over-engineer for the initial user count.

## Database rules

Store fish weight as integer grams.

Do not store kilograms using floating point.

Store fishing hole depth as integer centimeters when it can be parsed.

Examples:

6,00 m -> 600
7,63 m -> 763

Always preserve raw source text when parsing game notebook entries.

## Authentication

Initial roles:

USER
ADMIN

Authentication:

- email
- password
- nickname

Only emails whose domain ends with `.ru` are allowed.

Security-sensitive validation must always happen on the NestJS backend.

Passwords must never be stored in plaintext.

ADMIN can ban users.

Banned users cannot create public reports.

## Development workflow

Work incrementally.

Before implementing a task:

1. inspect the existing repository;
2. explain what you found;
3. make a short implementation plan;
4. only then modify files.

Never implement future phases unless explicitly requested.

Do not rewrite unrelated code.

When changing the database schema:

- create a Prisma migration;
- never silently reset development data unless explicitly authorized.

For important domain logic add tests.

After every implementation task run appropriate:

- lint
- typecheck
- tests
- build when appropriate

At the end of every task report:

- what was implemented;
- files created;
- files modified;
- database migrations;
- commands executed;
- tests executed;
- known limitations;
- recommended next step.

If requirements are ambiguous, ask instead of inventing game mechanics.