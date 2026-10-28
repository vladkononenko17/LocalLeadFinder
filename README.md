# LocalLead Finder

Приватный инструмент для поиска украинских офлайн-бизнесов, которым может быть полезен новый или улучшенный сайт.

## Production-архитектура

- **Vercel**: Next.js dashboard и API routes; проект защищён Vercel Authentication.
- **Supabase**: Postgres, magic-link вход и RLS. Таблица `leads` изолирована по `user_id`.
- **OpenStreetMap / Overpass**: реальные бизнесы, запрашиваемые только вручную.
- **PageSpeed Insights**: техническая проверка URL и Lighthouse-оценки performance, accessibility и SEO.

Отсутствие поля `website` в OSM **не является доказательством**, что у бизнеса нет сайта. В интерфейсе такой лид отмечается как «нет URL — неизвестно».

## Локальный запуск

Создайте `.env.local` из `.env.example`, укажите URL и publishable key Supabase, затем:

```bash
npm install
npm run dev
```

В Supabase нужно добавить адрес локального или production-приложения в **Authentication → URL Configuration**.

## Миграции

`supabase/migrations/20261024170000_create_leads.sql` создаёт основную таблицу, индексы и RLS-политику. Любая выдача и изменение лидов ограничены текущим пользователем.

## Правила источников

Не делайте массовых частых запросов к Overpass/Nominatim: между широкими поисками оставляйте паузу 10–20 секунд и соблюдайте [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) и [Overpass guidelines](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
