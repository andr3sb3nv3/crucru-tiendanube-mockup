# Agente para reservar turnos en Golf Tracker

Este proyecto incluye una rutina Playwright para entrar a Golf Tracker, iniciar sesión, buscar un turno y dejarlo listo para confirmar.

Por seguridad, el agente corre en `dry run` por defecto: si encuentra el turno, lo selecciona y se detiene antes de confirmar. Para enviar la solicitud real hay que definir `GOLF_CONFIRM_BOOKING=true`.

## Configuración

```bash
cp .env.golf.example .env.golf
```

Editar `.env.golf` con:

- `GOLF_EMAIL`: usuario de Golf Tracker.
- `GOLF_PASSWORD`: contraseña.
- `GOLF_CLUB`: nombre visible del campo.
- `GOLF_BOOKING_TEXT`: opción o lugar visible dentro del flujo de reservas.
- `GOLF_PLAYERS`: cantidad de jugadores.
- `GOLF_DATE_OFFSET_DAYS`: días desde hoy hasta la fecha a reservar. Para el caso actual es `3`, porque lunes permite reservar jueves.
- `GOLF_ALLOWED_TARGET_DAYS`: días permitidos para la fecha objetivo, donde `0` es domingo y `6` es sábado. Por defecto están permitidos todos.
- `GOLF_TIME_WINDOW_START` y `GOLF_TIME_WINDOW_END`: rango de horarios aceptados.

Si `GOLF_DATE` está definido, el agente usa esa fecha puntual. Si no está definido, calcula la fecha usando `GOLF_DATE_OFFSET_DAYS`.

## Instalación

```bash
npm install
npx playwright install chromium
```

## Prueba sin confirmar

```bash
npm run golf:agent
```

El agente guarda capturas en `outputs/golf-agent/`. Si no encuentra algún paso, revisar la última captura para ajustar el selector o el texto usado por Golf Tracker.

## Confirmar una reserva real

```bash
GOLF_CONFIRM_BOOKING=true npm run golf:agent
```

## Reintentos

Para esperar a que aparezca un horario:

```bash
GOLF_MAX_ATTEMPTS=40 GOLF_POLL_SECONDS=30 npm run golf:agent
```

Eso revisa disponibilidad durante unos 20 minutos.

## Cargar solicitudes desde HTML

Levantar el formulario local:

```bash
npm run golf:planner
```

Abrir `http://localhost:5180`.

Ahí se carga:

- Día que querés jugar.
- Matrículas a anotar, una por línea o separadas por coma.
- Rango horario deseado.
- Opción/lugar de reserva.
- Cantidad de días de anticipación. Por defecto es `4`.

El formulario guarda cada solicitud en `data/golf-reservations.json`.

## Ejecución automática

La automatización de Codex corre todos los días a las 08:00, ejecuta:

```bash
npm run golf:due
```

Ese script revisa las solicitudes pendientes y solo corre las que tienen `bookingOpenDate` igual a hoy. Por ejemplo, si se carga una fecha de juego con 4 días de anticipación, el agente intentará reservar 4 días antes a las 08:00.

La configuración actual busca el primer horario disponible entre 12:30 y 14:30, priorizando el más temprano.

Si Golf Tracker cuenta la anticipación de forma inclusiva, como el ejemplo “lunes reserva jueves”, cargar `3` en “Días antes” para esa solicitud.
