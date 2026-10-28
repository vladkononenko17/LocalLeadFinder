# LocalLead Finder

Приватный инструмент для поиска украинских офлайн-бизнесов, которым может быть полезен новый или улучшенный сайт.

## Production-архитектура

- **Vercel**: Next.js dashboard и API routes; проект защищён Vercel Authentication.
- **Supabase**: Postgres, magic-link вход и RLS. Таблица `leads` изолирована по `user_id`.
- **OpenStreetMap / Overpass**: реальные бизнесы, запрашиваемые только вручную.
- **PageSpeed Insights**: техническая проверка URL и Lighthouse-оценки performance, accessibility и SEO.

## Источники поиска

- **Google Maps (Places API New, Text Search)** — основной источник для лидов: у мест есть `websiteUri`, телефон, рейтинг и число отзывов. Отсутствие сайта в Google — сильный сигнал. Круг поиска режется на тайлы: если тайл вернул лимит в 60 мест, он делится на 4, пока не кончится бюджет `GOOGLE_MAX_REQUESTS`. Поля сайта/телефона/рейтинга тарифицируются по Enterprise SKU (1 000 бесплатных запросов в месяц, далее ≈ $35 за 1 000).
- **OpenStreetMap / Overpass** — бесплатный дополнительный источник; опрашивается параллельно с Google.
- Дубли между источниками склеиваются по телефону, домену сайта или похожему названию в радиусе 150 м.
- Ссылка на Instagram/Facebook/Linktree вместо сайта считается отдельным сильным сигналом («только соцсеть»).
- Apple Maps Server API не отдаёт телефон и сайт, у Waze нет публичного API поиска мест, поэтому как источники лидов они не подключены.

Перед деплоем примените миграцию `20261028170000_multi_source_leads.sql`. Тесты: `npm test`.

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
