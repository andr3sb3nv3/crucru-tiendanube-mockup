# Deploy en Railway

## Arquitectura

En produccion la app usa:

- Servicio web Node: sirve `golf-reservas/index.html` y la API `/api/reservations`.
- PostgreSQL: guarda solicitudes y estados.
- Servicio cron de Railway: ejecuta `npm run golf:due` todos los dias a las 08:00 de Argentina.
- Playwright/Chromium: corre dentro del contenedor Docker.

Localmente, si no existe `DATABASE_URL`, la app sigue usando `data/golf-reservations.json`.

## Servicios en Railway

1. Crear un proyecto en Railway desde el repo de GitHub.
2. Agregar un servicio PostgreSQL.
3. En el servicio web, configurar `DATABASE_URL` apuntando a `${{Postgres.DATABASE_URL}}`.
4. El servicio web debe usar el Dockerfile del repo y el comando por defecto `npm start`.
5. Generar dominio publico para el servicio web.
6. Crear un segundo servicio desde el mismo repo para el cron.
7. En el servicio cron, usar el comando:

```bash
npm run golf:due
```

8. En el servicio cron, configurar Cron Schedule:

```cron
0 8 * * *
```

Railway corre cron segun la zona horaria configurada por la plataforma; mantener `TZ=America/Argentina/Buenos_Aires` como variable para que el script interprete fechas locales.

## Variables

Configurar estas variables en ambos servicios, web y cron:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
TZ=America/Argentina/Buenos_Aires
GOLF_EMAIL=andres.benve@gmail.com
GOLF_PASSWORD=...
GOLF_CLUB=Lagos de Palermo
GOLF_BOOKING_TEXT=practica deportiva feriado
GOLF_CONFIRM_BOOKING=true
GOLF_HEADLESS=true
GOLF_ALLOWED_TARGET_DAYS=0,1,2,3,4,5,6
GOLF_ENFORCE_ALLOWED_DAYS=false
GOLF_TIME_WINDOW_START=12:30
GOLF_TIME_WINDOW_END=14:30
GOLF_MAX_ATTEMPTS=1
GOLF_RESERVATION_SETTLE_SECONDS=180
GOLF_BASE_RESERVATION_SECONDS=180
GOLF_RESERVATION_TRANSITION_SECONDS=45
```

En el servicio web, dejar:

```bash
GOLF_ENABLE_INTERNAL_SCHEDULER=false
```

Asi el web no ejecuta reservas por intervalo; solo guarda solicitudes y permite `Intentar ahora`.

## Prueba segura

Antes de activar reservas reales:

```bash
GOLF_CONFIRM_BOOKING=false
```

Crear una solicitud desde la web y usar `Generar solicitud ahora` para validar login, grilla y modal sin confirmar.

Cuando este validado, volver a:

```bash
GOLF_CONFIRM_BOOKING=true
```
