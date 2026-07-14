# Deploy en Railway

## Arquitectura

En produccion la app usa:

- Servicio web Node siempre encendido: sirve la interfaz y ejecuta el worker de reservas.
- PostgreSQL: guarda solicitudes, estados, logs, heartbeat y reclamos atomicos.
- Playwright/Chromium: corre como proceso hijo dentro del contenedor Docker.
- Cron opcional: solo funciona como respaldo; no es el disparador principal de las 08:00.

El worker revisa PostgreSQL cada segundo. Golf Tracker prepara el navegador 90 segundos antes, inicia sesion y hace el primer intento a las 08:01. Si a las 08:08 todavia no comenzo a enviar la primera reserva, cierra ese intento y vuelve automaticamente a la cola para precalentar un segundo intento a las 08:10. El boton `Generar solicitud ahora` usa la misma cola y el mismo ejecutor.

Railway Cron no debe ser el disparador principal: usa UTC y no garantiza precision al minuto. Localmente, si no existe `DATABASE_URL`, la app sigue usando `data/golf-reservations.json`.

## Servicio web

1. Crear un proyecto en Railway desde el repo de GitHub.
2. Agregar PostgreSQL.
3. En el servicio web, referenciar `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
4. Usar el Dockerfile del repo y el comando por defecto `npm start`.
5. Generar un dominio publico solo para el servicio web.
6. Configurar Restart Policy en `Always` cuando el plan de Railway lo permita.

No hace falta un servicio worker separado: para este volumen, el worker vive en el proceso web y PostgreSQL permite recuperar una tarea si Railway reinicia el contenedor.

## Variables

Configurar estas variables en el servicio web:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
TZ=America/Argentina/Buenos_Aires

GOLF_EMAIL=...
GOLF_PASSWORD=...
GOLF_CLUB=Lagos de Palermo
GOLF_BOOKING_TEXT=practica deportiva feriado
GOLF_CONFIRM_BOOKING=true
GOLF_HEADLESS=true
GOLF_ALLOWED_TARGET_DAYS=0,1,2,3,4,5,6
GOLF_ENFORCE_ALLOWED_DAYS=false
GOLF_TIME_WINDOW_START=12:30
GOLF_TIME_WINDOW_END=14:30
GOLF_SCHEDULED_MAX_ATTEMPTS=20
GOLF_SCHEDULED_POLL_SECONDS=1
GOLF_PRODUCTION_RUN_TIME=08:01
GOLF_SCHEDULED_RETRY_TIME=08:10
GOLF_SCHEDULED_RETRIES=1
GOLF_INITIAL_ATTEMPT_DEADLINE_TIME=08:08
GOLF_RESERVATION_SETTLE_SECONDS=240
GOLF_BASE_RESERVATION_SECONDS=240
GOLF_RESERVATION_TRANSITION_SECONDS=90

JOCKEY_URL=https://golf.e-jockeyclub.org.ar/golf/login.php
JOCKEY_USERNAME=...
JOCKEY_PASSWORD=...
JOCKEY_TOURNAMENT_TEXT=AZUL
JOCKEY_CONFIRM_BOOKING=true
JOCKEY_HEADLESS=true
JOCKEY_SCHEDULED_MAX_ATTEMPTS=20
JOCKEY_SCHEDULED_POLL_SECONDS=1

NEWMAN_URL=https://www.clubnewmangolf.com/golf/login.php
NEWMAN_ADVANCE_DAYS=2

GOLF_RUNNER_ENABLED=true
GOLF_WORKER_POLL_MS=1000
GOLF_WORKER_CONCURRENCY=2
GOLF_WORKER_PREWARM_SECONDS=90
GOLF_WORKER_STALE_MS=15000
GOLF_WORKER_MAX_ATTEMPTS=2
GOLF_JOB_TIMEOUT_SECONDS=900
RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30
```

`GOLF_ENABLE_INTERNAL_SCHEDULER` ya no se usa. Puede eliminarse de Railway.

## Cron de respaldo

El cron es opcional. Si se conserva, debe compartir `DATABASE_URL` y las credenciales del servicio web, usar `npm run golf:due` y programarse despues de la apertura. Para las 08:00 de Argentina, Railway evalua el cron en UTC; el respaldo puede configurarse a las 11:05 UTC:

```cron
5 11 * * *
```

El script ahora cierra PostgreSQL al terminar, por lo que Railway no lo deja activo ni salta la ejecucion siguiente.

## Prueba segura

Para recorrer el flujo sin confirmar:

```bash
GOLF_CONFIRM_BOOKING=false
JOCKEY_CONFIRM_BOOKING=false
```

En produccion real ambos deben estar en `true`. Una tarea solo queda `done` cuando el proceso de Playwright termina su verificacion; cualquier excepcion o timeout queda `failed` con el motivo en la tabla.
