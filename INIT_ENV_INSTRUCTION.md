# INIT_ENV_INSTRUCTION

Пошаговая инструкция: от пустого `.env` до живой проверки Telegram-интеграции
(Chapter 3 — gramjs client + matcher).

---

## Зачем два набора кред (`TG_API_ID/HASH` и `TG_SESSION_STRING`)

Это архитектура MTProto Telegram — две разные сущности.

**`TG_API_ID` + `TG_API_HASH` идентифицируют приложение**, не аккаунт. Это как
`client_id`/`client_secret` в OAuth: Telegram хочет знать, какой клиент стучится в их
API. У Telegram Desktop, Telegram iOS, Telegram Web — у каждого свой api_id, выданный
на https://my.telegram.org.

**Логин (телефон → код → 2FA) идентифицирует аккаунт.** Результат склейки —
`TG_SESSION_STRING`: «это приложение, залогиненное как этот пользователь».

Почему это важно нам:

1. **gramjs — библиотека, а не клиент Telegram.** У неё нет «своего» api_id, и не
   должно быть — иначе забан одного бота на gramjs клал бы всех. Telegram заставляет
   каждого разработчика регистрировать своё приложение.
2. **Bot API (`api.telegram.org`) этого не требует** — там `bot_token` от @BotFather
   совмещает приложение и аккаунт. Но боты не могут читать каналы без админ-прав,
   поэтому в [docs/PLAN.md](docs/PLAN.md) выбран userbot/MTProto, а не Bot API.
3. **Один api_id логинит много аккаунтов**, и один аккаунт может быть залогинен через
   много приложений (по сессии на каждое — Telegram → Settings → Devices). Поэтому
   api_id/hash ставится в `.env` один раз и переживает любую смену forwarding-аккаунта;
   `TG_SESSION_STRING` — переменная часть.

---

## 1. Подготовь креды

```bash
cp .env.example .env
```

В `.env` заполни (минимум):

- `TG_API_ID` и `TG_API_HASH` — с https://my.telegram.org → API development tools
  (это креды твоего приложения, не аккаунта)
- `WEB_PASSWORD=anything` и `SESSION_SECRET=$(openssl rand -hex 32)` — пока не
  используются, но zod на них не ругается (они `.optional()`)

## 2. Накати миграции (база уже создана прошлым шагом, но команда идемпотентна)

```bash
pnpm db:migrate
```

## 3. Залогинься forwarding-аккаунтом

**Важно:** это должен быть отдельный аккаунт, не твой основной — gramjs склеивает все
сессии, и Telegram легко классифицирует userbot как спам.

```bash
pnpm tg:login
```

Скрипт спросит:

- номер телефона в формате `+...`
- код, пришедший в Telegram
- 2FA-пароль (если установлен; иначе Enter)

В конце он напечатает `TG_SESSION_STRING` — скопируй в `.env`.

## 4. Smoke-запуск без подписок

```bash
pnpm --filter @tg-feed/server dev
```

Должно появиться:

```
[..] INFO: connected to Telegram
[..] INFO: tg-feed server ready
```

Если видишь `Missing required Telegram env vars` — что-то из трёх `TG_*` не заполнено.

Проверь Ctrl+C: сервер должен залогировать `shutting down` и выйти за < 1 сек. Если
висит — это регрессия в `disconnect → destroy → closeDb`.

## 5. Проверь matcher на реальном канале

Нужен канал, на который **forwarding-аккаунт уже подписан**, и его `chat_id`. Самый
дешёвый способ узнать id — открыть нужное сообщение в Telegram Web
(`web.telegram.org`); URL вида `#-1001234567890_42` даёт `chatId=-1001234567890`.

Вставь подписку прямо в SQLite:

```bash
sqlite3 data/tg-feed.sqlite "INSERT INTO subscriptions (source_chat_id, source_title, destination_chat_id, enabled, created_at) VALUES ('-1001234567890', 'test channel', '-1001234567890', 1, $(date +%s%3N));"
```

(`destination_chat_id` сейчас не используется, заполни тем же значением.)

Перезапусти `pnpm --filter @tg-feed/server dev` — на старте увидишь запись о попытке
`getEntity` для этой подписки (на debug-уровне; чтобы её увидеть, временно подними
`LOG_LEVEL=debug` в `.env`). Если канал недоступен forwarding-аккаунту — лог
`failed to resolve subscription on startup` с warn.

Теперь напиши что-нибудь в этот канал. В логах сервера должно появиться:

```
INFO: message matched subscription
  subscriptionId: 1
  sourceChatId: "-1001234567890"
  messageId: "123"
  hasMedia: false
```

Если матчинга нет, но сообщения в канал идут — посмотри `LOG_LEVEL=debug`: там будет
`message has no matching subscription` с реальным `chatId`, который пришёл из gramjs
(полезно сравнить со значением в БД).

## 6. Что Chapter 3 ещё **не** делает

- Не пересылает сообщения — это Chapter 4 (`forwarding/`).
- Не создаёт записи в `forward_log`.
- Не делает join по `@username`/invite — это Chapter 10, когда появится UI для
  добавления подписок.

Если все четыре сигнала (boot ready → канал резолвится → событие приходит → корректный
shutdown по Ctrl+C) работают — глава закрыта.
