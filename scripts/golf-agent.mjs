import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { RESERVATION_WRITE_STARTED_MARKER } from "./golf-reservation-retry.mjs";

process.env.TZ = "America/Argentina/Buenos_Aires";
loadEnvFile(".env.golf");

const config = {
  url: env("GOLF_URL", "https://www.golf-tracker.com/main"),
  email: requiredEnv("GOLF_EMAIL"),
  password: requiredEnv("GOLF_PASSWORD"),
  club: env("GOLF_CLUB", ""),
  bookingText: env("GOLF_BOOKING_TEXT", ""),
  date: env("GOLF_DATE", targetDateFromOffset()),
  time: env("GOLF_TIME", ""),
  timeWindowStart: env("GOLF_TIME_WINDOW_START", "12:30"),
  timeWindowEnd: env("GOLF_TIME_WINDOW_END", "14:30"),
  playerData: parsePlayerData(env("GOLF_PLAYERS_DATA", ""), env("GOLF_MEMBER_IDS", "")),
  memberIds: [],
  players: Number(env("GOLF_PLAYERS", "1")),
  allowedTargetDays: parseAllowedDays(env("GOLF_ALLOWED_TARGET_DAYS", "0,1,2,3,4,5,6")),
  enforceAllowedDays: booleanEnv("GOLF_ENFORCE_ALLOWED_DAYS", false),
  confirmBooking: booleanEnv("GOLF_CONFIRM_BOOKING", false),
  headless: booleanEnv("GOLF_HEADLESS", true),
  pollSeconds: Number(env("GOLF_POLL_SECONDS", "15")),
  maxAttempts: Number(env("GOLF_MAX_ATTEMPTS", "1")),
  outputDir: env("GOLF_OUTPUT_DIR", "outputs/golf-agent"),
  settleSeconds: Number(env("GOLF_RESERVATION_SETTLE_SECONDS", "240")),
  baseReservationSeconds: Number(env("GOLF_BASE_RESERVATION_SECONDS", "240")),
  transitionSeconds: Number(env("GOLF_RESERVATION_TRANSITION_SECONDS", "90")),
  notBeforeLocal: env("GOLF_NOT_BEFORE_LOCAL", ""),
};

fs.mkdirSync(config.outputDir, { recursive: true });
config.memberIds = config.playerData.map((player) => player.memberId);
if (config.memberIds.length) config.players = config.memberIds.length;

const browser = await chromium.launch({ headless: config.headless });
const context = await browser.newContext({
  locale: "es-AR",
  timezoneId: "America/Argentina/Buenos_Aires",
});
const page = await context.newPage();

try {
  await runAgent();
} catch (error) {
  await capture("error");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await context.storageState({ path: path.join(config.outputDir, "storage-state.json") });
  await browser.close();
}

async function runAgent() {
  assertTargetDay();

  console.log(`Abriendo ${config.url}`);
  await page.goto(config.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await capture("01-home");

  await openPlayerPortalIfVisible();
  await selectClubIfVisible();
  await loginIfNeeded();
  await openBooking();
  await waitUntilNotBefore();

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    console.log(
      `Buscando turno ${config.date} entre ${config.timeWindowStart} y ${config.timeWindowEnd} (${attempt}/${config.maxAttempts})`,
    );
    await chooseBookingCriteria();
    await waitForScheduleReady();
    await closeFloatingChatIfVisible();

    const slot = await findSlot();
    if (slot) {
      await clickSlot(slot);
      await page.waitForTimeout(700);
      await capture("03-slot-selected");

      if (!config.confirmBooking) {
        console.log("Turno encontrado. Dry run activo: no se confirmó la reserva.");
        console.log("Para confirmar, usar GOLF_CONFIRM_BOOKING=true.");
        process.exitCode = 2;
        return;
      }

      await reservePrimaryPlayer();
      await waitForBaseReservation();
      await addLinePlayersIfNeeded();
      await waitForFinalReservationCompletion();
      await capture("04-reservation-confirmed");
      console.log("Solicitud de reserva enviada.");
      return;
    }

    await capture(`02-no-slot-attempt-${attempt}`);
    if (attempt < config.maxAttempts) {
      await page.waitForTimeout(config.pollSeconds * 1000);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  }

  throw new Error(
    `No encontré un turno visible para ${config.date} entre ${config.timeWindowStart} y ${config.timeWindowEnd}.`,
  );
}

async function closeFloatingChatIfVisible() {
  const close = await firstVisible([
    page.locator("[class*='chat'], [class*='caddy'], .card, div").filter({ hasText: /caddy virtual/i }).locator(".bi-x, .bi-x-lg, [class*='close'], [class*='Close'], button").last(),
  ], 500);

  if (!close) return;
  await close.click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
}

async function waitForScheduleReady() {
  console.log("Esperando que termine de cargar la grilla.");
  await page.getByText(/cargando/i).first().waitFor({ state: "hidden", timeout: 25000 }).catch(() => {});

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const loading = await page.getByText(/cargando/i).count().catch(() => 0);
    const available = await page.locator(".test_cell_business").count().catch(() => 0);
    const cells = await page.locator(".test_cell_business, .test_cell_inner").count().catch(() => 0);
    if (!loading && available > 0) {
      await page.waitForTimeout(600);
      return;
    }
    if (!loading && cells > 20) {
      await page.waitForTimeout(1200);
      const lateAvailable = await page.locator(".test_cell_business").count().catch(() => 0);
      if (lateAvailable > 0) return;
    }
    await page.waitForTimeout(700);
  }
}

async function clickSlot(slot) {
  const pointNames = ["centro", "acción derecha", "botón interno", "dom click", "doble click centro"];

  for (let attempt = 1; attempt <= pointNames.length; attempt += 1) {
    await closeFloatingChatIfVisible();
    await slot.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(180);
    const box = await slot.boundingBox().catch(() => null);
    if (!box) continue;

    const topBefore = await topHitInfo(slot);
    console.log(`Intento abrir turno (${pointNames[attempt - 1]}): ${JSON.stringify(topBefore)}`);

    if (attempt === 3 && await clickInnerSlotAction(slot)) {
      await page.waitForTimeout(900);
      if (await reservationPanelIsOpen()) return;
      console.log(`Click en turno sin cartel visible (${pointNames[attempt - 1]}).`);
      continue;
    }

    if (attempt === 4) {
      await dispatchSlotClick(slot);
      await page.waitForTimeout(900);
      if (await reservationPanelIsOpen()) return;
      console.log(`Click en turno sin cartel visible (${pointNames[attempt - 1]}).`);
      continue;
    }

    const useRightAction = attempt === 2;
    const useDoubleClick = attempt === 5;
    const x = useRightAction ? box.x + box.width - Math.min(18, box.width / 5) : box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.waitForTimeout(120);
    if (useDoubleClick) {
      await page.mouse.dblclick(x, y);
    } else {
      await page.mouse.click(x, y);
    }
    await page.waitForTimeout(900);

    if (await reservationPanelIsOpen()) return;
    console.log(`Click en turno sin cartel visible (${pointNames[attempt - 1]}).`);
  }

  throw new Error("Encontré un turno, pero no se abrió el cartel para reservarlo.");
}

async function clickInnerSlotAction(slot) {
  const action = slot.locator("button, a, [role='button'], .bi-list, .bi-three-dots, i, svg").last();
  if (!(await isVisible(action, 400))) return false;
  await action.click({ force: true }).catch(() => {});
  return true;
}

async function dispatchSlotClick(slot) {
  await slot.evaluate((element) => {
    const target = element.querySelector("button, a, [role='button'], i, svg") || element;
    const rect = target.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    target.dispatchEvent(new PointerEvent("pointerover", init));
    target.dispatchEvent(new PointerEvent("pointerenter", init));
    target.dispatchEvent(new MouseEvent("mouseover", init));
    target.dispatchEvent(new MouseEvent("mouseenter", init));
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new MouseEvent("mousedown", init));
    target.dispatchEvent(new PointerEvent("pointerup", init));
    target.dispatchEvent(new MouseEvent("mouseup", init));
    target.dispatchEvent(new MouseEvent("click", init));
  }).catch(() => {});
}

async function reservationPanelIsOpen() {
  if (await waitForAddPlayersButton(250)) return true;
  if (await firstVisible([
    page.getByText(/reserva creada|creada con éxito|reservando/i).first(),
  ], 250)) return true;
  return Boolean(await reservationActionButton());
}

async function reservePrimaryPlayer() {
  console.log("Reservando el primer espacio con el usuario logueado.");
  const reserve = await waitForReservationButton(8000);
  if (!reserve) {
    throw new Error("Se abrió el turno, pero no encontré el botón Reservar para el primer jugador.");
  }

  console.log(RESERVATION_WRITE_STARTED_MARKER);
  await reserve.click({ force: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

async function waitUntilNotBefore() {
  if (!config.notBeforeLocal) return;

  const target = new Date(config.notBeforeLocal);
  if (!Number.isFinite(target.getTime()) || target.getTime() <= Date.now()) return;

  console.log(`Sesión preparada; espero hasta ${config.notBeforeLocal} para buscar el turno.`);
  while (Date.now() < target.getTime()) {
    await page.waitForTimeout(Math.min(1000, Math.max(1, target.getTime() - Date.now())));
  }
  console.log("Horario de apertura alcanzado; comienzo la búsqueda.");
}

async function addLinePlayersIfNeeded() {
  const extraPlayers = config.playerData.slice(1);
  if (!extraPlayers.length) return;

  console.log(`Intentando agregar jugadores a la línea: ${extraPlayers.map((player) => player.memberId).join(", ")}`);

  for (let index = 0; index < extraPlayers.length; index += 1) {
    const player = extraPlayers[index];
    const isLast = index === extraPlayers.length - 1;
    const addPlayers = await waitForAddPlayersButton();
    if (!addPlayers) {
      throw new Error(`La reserva base se creó, pero no encontré cómo agregar la matrícula ${player.memberId}.`);
    }

    await addPlayers.click({ force: true }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);

    const fields = await visibleMemberFields();
    if (!fields.length) {
      console.log(`No encontré campo para cargar la matrícula ${player.memberId}.`);
      continue;
    }

    await fillPlayerData(player, fields);
    await verifyPlayer(player);
    await reserveAddedPlayer(player, { isLast });

    if (!isLast) {
      await waitForAddedPlayerReadyForNext(player);
    }
  }
}

async function fillPlayerData(player, fields, options = {}) {
  const licenseField = findField(fields, /matr[ií]cula|licen|socio|member/) || fields[0];
  await fillOneMemberValue(player.memberId, licenseField.locator);

  if (options.primary || !player.documentId) return;

  const documentField = findField(fields, /dni|document|doc\.?|identidad/) || fields.find((field) => field !== licenseField);
  if (!documentField) {
    console.log(`No encontré campo de DNI/documento para la matrícula ${player.memberId}.`);
    return;
  }

  await fillOneMemberValue(player.documentId, documentField.locator);
}

function findField(fields, matcher) {
  return fields.find((field) => matcher.test(field.text));
}

async function fillOneMemberValue(value, field) {
  await field.click({ force: true }).catch(() => {});
  await field.fill("");
  await field.fill(value);
  await page.waitForTimeout(250);
}

async function waitForBaseReservation() {
  console.log("Esperando que Golf Tracker cree la reserva base.");
  const deadline = Date.now() + config.baseReservationSeconds * 1000;

  while (Date.now() < deadline) {
    await closeFloatingChatIfVisible();
    if (await waitForAddPlayersButton(800)) {
      console.log("Reserva base creada; ya aparece la opción para agregar jugadores.");
      return;
    }

    const successText = await firstVisible([
      page.getByText(/reserva creada|creada con éxito|agregar jugadores/i).first(),
    ], 500);
    if (successText) {
      console.log("Reserva base creada.");
      return;
    }

    const action = await reservationActionButton();
    if (action) {
      await action.click({ force: true }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1200);
      continue;
    }

    const reserving = await page.getByText(/reservando/i).count().catch(() => 0);
    if (reserving) {
      await page.waitForTimeout(1200);
      continue;
    }

    await page.waitForTimeout(800);
  }

  throw new Error(`El sitio quedó esperando la creación de la reserva base por más de ${config.baseReservationSeconds} segundos y no apareció la opción para agregar jugadores.`);
}

async function verifyPlayer(player) {
  const verify = await firstVisible([
    page.getByRole("button", { name: /verificar matr[ií]cula|verificar|validar|buscar/i }),
    page.locator("button").filter({ hasText: /verificar matr[ií]cula|verificar|validar|buscar/i }).first(),
  ], 5000);

  if (!verify) {
    console.log(`No encontré botón de verificar para ${player.memberId}; intento reservar directo.`);
    return;
  }

  console.log(`Verificando matrícula ${player.memberId}.`);
  await verify.click({ force: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

async function reserveAddedPlayer(player, options = {}) {
  const reserve = await waitForReservationButton(8000);
  if (!reserve) {
    throw new Error(`Verifiqué/cargué la matrícula ${player.memberId}, pero no encontré el botón Reservar.`);
  }

  console.log(`Reservando jugador ${player.memberId}.`);
  await reserve.click({ force: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitForReservationTransitionStart(player.memberId, { isLast: Boolean(options.isLast) });
}

async function waitForAddedPlayerReadyForNext(player) {
  console.log(`Esperando que Golf Tracker confirme a ${player.memberId} antes de agregar el siguiente.`);
  const deadline = Date.now() + config.settleSeconds * 1000;

  while (Date.now() < deadline) {
    if (await waitForAddPlayersButton(1200)) return;

    const reservingCount = await reservingTextCount();
    if (!reservingCount) {
      await page.waitForTimeout(700);
      if (await waitForAddPlayersButton(1200)) return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`Golf Tracker quedó en "Reservando..." después de agregar la matrícula ${player.memberId}.`);
}

async function waitForFinalReservationCompletion() {
  console.log("Esperando confirmación final de la línea completa.");
  const deadline = Date.now() + config.settleSeconds * 1000;
  let clearSince = 0;

  while (Date.now() < deadline) {
    const reservingCount = await reservingTextCount();
    if (reservingCount) {
      clearSince = 0;
      await page.waitForTimeout(1200);
      continue;
    }

    if (!clearSince) clearSince = Date.now();

    if (Date.now() - clearSince >= 5000) {
      console.log("Reservando desapareció de forma estable; reserva finalizada.");
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`La línea quedó en "Reservando..." o sin estabilizar por más de ${config.settleSeconds} segundos; no marco la solicitud como completada.`);
}

async function waitForReservationTransitionStart(label, options = {}) {
  const deadline = Date.now() + config.transitionSeconds * 1000;

  while (Date.now() < deadline) {
    const reservingCount = await reservingTextCount();
    if (!reservingCount) {
      const addPlayers = options.isLast ? null : await waitForAddPlayersButton(500);
      if (addPlayers) {
        console.log(`Golf Tracker ya permite agregar otro jugador después de ${label}.`);
        return "next";
      }

      if (options.isLast && await finalPlayerFormClosed()) {
        console.log(`Golf Tracker cerró el formulario después de reservar a ${label}.`);
        return "submitted";
      }
      await page.waitForTimeout(700);
      continue;
    }

    console.log(`Golf Tracker empezó a procesar la reserva de ${label}.`);
    return "reserving";
  }

  if (options.isLast) {
    throw new Error(`Después de reservar a ${label}, Golf Tracker no mostró "Reservando..." ni cerró el formulario en ${config.transitionSeconds} segundos.`);
  }

  console.log(`No vi aparecer Reservando para ${label} en ${config.transitionSeconds} segundos; sigo esperando el siguiente estado.`);
  return "timeout";
}

async function finalPlayerFormClosed() {
  const reserve = await waitForReservationButton(250);
  if (reserve) return false;

  const fields = await visibleMemberFields();
  return fields.length === 0;
}

async function reservingTextCount() {
  return page.getByText(/reservando/i).count().catch(() => 0);
}

async function waitForReservationButton(timeout = 5000) {
  return firstVisible([
    page.getByRole("button", { name: /^reservar$/i }),
    page.locator("button").filter({ hasText: /^reservar$/i }).first(),
    page.getByRole("button", { name: /^(?!.*jugadores a la línea).*(reservar|solicitar)$/i }),
    page.locator("button").filter({ hasText: /reservar|solicitar/i }).filter({ hasNotText: /jugadores a la línea/i }).first(),
  ], timeout);
}

async function waitForAddPlayersButton(timeout = 8000) {
  return firstVisible([
    page.getByRole("button", { name: /agregar jugadores|agregar jugador|sumar jugador|añadir jugador|anotar jugador/i }),
    page.locator("button, a").filter({ hasText: /agregar jugadores|agregar jugador|sumar jugador|añadir jugador|anotar jugador/i }).first(),
  ], timeout);
}

async function reservationActionButton() {
  return firstVisible([
    page.getByRole("button", { name: /^(?!.*jugadores a la línea).*(socio|confirmar|reservar|solicitar|finalizar|guardar|aceptar|sí|si)/i }),
    page.locator("button").filter({ hasText: /socio|confirmar|reservar|solicitar|finalizar|guardar|aceptar|sí|si/i }).filter({ hasNotText: /jugadores a la línea/i }).first(),
  ], 500);
}

async function visibleMemberFields() {
  const locator = page.locator("input:not([type='password']):not([type='email']), textarea");
  const count = await locator.count();
  const fields = [];

  for (let index = 0; index < count; index += 1) {
    const field = locator.nth(index);
    if (!(await isVisible(field, 150))) continue;
    if (await looksLikeChatOrNewsletter(field)) continue;
    const type = await field.getAttribute("type").catch(() => "");
    if (["hidden", "date", "time"].includes(String(type || "").toLowerCase())) continue;
    const text = await fieldContextText(field);
    if (/jugadores|personas|players|hoyos/i.test(text)) continue;
    fields.push({ locator: field, text });
  }

  fields.sort((a, b) => fieldRank(b.text) - fieldRank(a.text));
  return fields;
}

async function fieldContextText(locator) {
  try {
    return normalizeSpaces(await locator.evaluate((element) => {
      const id = element.getAttribute("id");
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      const container = element.closest("label, .form-group, .mb-3, .row, .modal, form") || element.parentElement;
      return [
        label || "",
        element.getAttribute("name") || "",
        element.getAttribute("formcontrolname") || "",
        element.getAttribute("placeholder") || "",
        element.getAttribute("aria-label") || "",
        container?.textContent || "",
      ].join(" ");
    }));
  } catch {
    return "";
  }
}

function fieldRank(text) {
  if (/matr[ií]cula|licen|socio|member/i.test(text)) return 3;
  if (/dni|document|identidad/i.test(text)) return 2;
  return 1;
}

async function looksLikeChatOrNewsletter(locator) {
  try {
    const text = await locator.evaluate((element) => {
      const container = element.closest("form, .modal, .card, app-chat, .chat") || element.parentElement;
      return [
        element.getAttribute("placeholder") || "",
        element.getAttribute("aria-label") || "",
        container?.textContent || "",
      ].join(" ");
    });
    return /caddy virtual|escribe tu mensaje|newsletter|suscrib|actualizaciones/i.test(text);
  } catch {
    return false;
  }
}

async function openPlayerPortalIfVisible() {
  const playerEntry = await firstVisible([
    page.getByRole("button", { name: /selecciona tu club|accede a tu club|campos de golf/i }).first(),
    page.getByRole("link", { name: /campos de golf/i }).first(),
    page.locator("a, button").filter({ hasText: /selecciona tu club|campos de golf/i }).first(),
  ], 2500);

  if (!playerEntry) return;

  console.log("Entrando a la lista de campos");
  await playerEntry.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}

async function selectClubIfVisible() {
  if (config.club) {
    const clubMatcher = textMatcher(config.club);
    const clubCard = page.getByText(clubMatcher).first();
    if (await isVisible(clubCard, 4000)) {
      console.log(`Seleccionando club: ${config.club}`);
      await clubCard.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  }

  const enterClub = await firstVisible([
    page.getByRole("link", { name: /ingresar/i }).first(),
    page.getByRole("button", { name: /ingresar/i }).first(),
    page.locator("a, button").filter({ hasText: /ingresar/i }).first(),
  ], 2500);

  if (enterClub) {
    console.log("Ingresando al club");
    await enterClub.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function loginIfNeeded() {
  await openLoginPanelIfVisible();

  const passwordInput = await firstVisible([
    page.getByLabel(/password|contraseña|clave/i),
    page.getByPlaceholder(/password|contraseña|clave/i),
    page.locator('input[type="password"]').first(),
  ], 2500);

  if (!passwordInput) {
    console.log("No veo campo de contraseña; asumo sesión iniciada o pendiente de elegir club.");
    return;
  }

  const emailInput = await firstVisible([
    page.getByLabel(/email|correo|usuario|mail/i),
    page.getByPlaceholder(/email|correo|usuario|mail/i),
    page.locator('input[type="email"]').first(),
    page.locator('input[name*="email" i], input[name*="user" i]').first(),
  ]);

  if (!emailInput) {
    throw new Error("Encontré contraseña, pero no encontré el campo de usuario/email.");
  }

  if (await looksLikeNewsletter(emailInput)) {
    console.log("El campo de email visible parece ser newsletter, no login.");
    return;
  }

  console.log("Ingresando credenciales");
  await emailInput.fill(config.email);

  await passwordInput.fill(config.password);

  const submit = await firstVisible([
    page.getByRole("button", { name: /ingresar|entrar|acceder|login|iniciar|continuar/i }),
    page.locator('button[type="submit"]').first(),
  ]);
  if (!submit) {
    throw new Error("No encontré el botón para enviar el login.");
  }

  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    submit.click(),
  ]);
  await capture("02-after-login");
}

async function openLoginPanelIfVisible() {
  const trigger = await firstVisible([
    page.getByRole("button", { name: /ingresar|entrar|acceder|login|iniciar|mi cuenta/i }),
    page.getByRole("link", { name: /ingresar|entrar|acceder|login|iniciar|mi cuenta/i }),
    page.locator("button, a").filter({ hasText: /ingresar|entrar|acceder|login|iniciar|mi cuenta/i }).first(),
  ], 1800);

  if (!trigger) return;

  console.log("Abriendo panel de login");
  await trigger.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

async function looksLikeNewsletter(locator) {
  try {
    const text = await locator.evaluate((element) => {
      const form = element.closest("form") || element.parentElement;
      return form?.textContent || "";
    });
    return /suscrib|newsletter|actualizaciones|recibe/i.test(text);
  } catch {
    return false;
  }
}

async function openBooking() {
  let bookingNav = await bookingNavButton();

  if (bookingNav) {
    console.log("Entrando a reservas desde la navegación");
    await bookingNav.click();
  } else {
    console.log("No veo Reservas todavía; vuelvo al inicio y reentro al club.");
    await page.goto(config.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await openPlayerPortalIfVisible();
    await selectClubIfVisible();
    bookingNav = await bookingNavButton();
    if (!bookingNav) throw new Error("No encontré la navegación de Reservas después de entrar al club.");
    console.log("Entrando a reservas desde la navegación");
    await bookingNav.click();
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function bookingNavButton() {
  return firstVisible([
    page.getByRole("link", { name: /reserva|reservar|turno|booking/i }),
    page.getByRole("button", { name: /reserva|reservar|turno|booking/i }),
    page.locator("a, button").filter({ hasText: /reserva|reservar|turno|booking/i }).first(),
  ], 2500);
}

async function chooseBookingCriteria() {
  await fillDate(config.date);

  const playerInput = await firstVisible([
    page.getByLabel(/jugadores|personas|players/i),
    page.getByPlaceholder(/jugadores|personas|players/i),
    page.locator('input[type="number"]').first(),
  ]);
  if (playerInput && Number.isFinite(config.players)) {
    await playerInput.fill(String(config.players));
  }

  const search = await firstVisible([
    page.getByRole("button", { name: /buscar|consultar|ver|disponible|aplicar/i }),
    page.locator("button").filter({ hasText: /buscar|consultar|ver|disponible|aplicar/i }).first(),
  ]);
  if (search) {
    await search.click();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

async function selectBookingTextIfVisible() {
  if (!config.bookingText) return;

  const matcher = textMatcher(config.bookingText);
  const target = await firstVisible([
    page.getByRole("button", { name: matcher }).first(),
    page.getByRole("link", { name: matcher }).first(),
  ], 1200);

  if (!target) {
    console.log(`No encontré todavía el texto de reserva: ${config.bookingText}`);
    return;
  }

  console.log(`Seleccionando opción: ${config.bookingText}`);
  await target.click();
  await page.waitForTimeout(500);
}

async function fillDate(date) {
  const nativeDate = page.locator('input[type="date"]').first();
  if (await isVisible(nativeDate, 1000)) {
    await nativeDate.fill(date);
    await nativeDate.dispatchEvent("change");
    return;
  }

  if (await chooseDateFromCalendar(date)) return;

  const dateField = await firstVisible([
    page.getByLabel(/fecha|día|dia|date/i),
    page.getByPlaceholder(/fecha|día|dia|date/i),
    page.locator('input[name*="date" i], input[name*="fecha" i]').first(),
  ]);
  if (!dateField) {
    throw new Error("No encontré campo de fecha en la pantalla de reservas.");
  }

  await dateField.fill(date);
  await dateField.press("Enter").catch(() => {});
}

async function chooseDateFromCalendar(date) {
  const target = dateFromIso(date);
  const targetDay = String(target.getDate());
  const currentHeading = page.getByText(dateHeadingMatcher(date)).first();
  if (await isVisible(currentHeading, 800)) {
    console.log(`La pantalla ya está en la fecha objetivo ${date}`);
    return true;
  }

  const calendarButton = await firstVisible([
    page.locator("button").filter({ has: page.locator(".bi-calendar, .fa-calendar, [class*='calendar']") }).first(),
  ], 1200);

  const visualCalendarButton = calendarButton || (await topDateControlButton());
  if (!visualCalendarButton) return false;

  console.log(`Abriendo calendario para elegir ${date}`);
  await visualCalendarButton.click({ force: true });
  await page.waitForTimeout(500);

  const dayButton = await firstVisible([
    page.getByRole("button", { name: new RegExp(`^${targetDay}$`) }).first(),
    page.locator("button, [role='button'], .ngb-dp-day").filter({ hasText: new RegExp(`^\\s*${targetDay}\\s*$`) }).first(),
    page.locator("ngb-datepicker, .ngb-dp-month, .dropdown-menu, .datepicker").getByText(new RegExp(`^\\s*${targetDay}\\s*$`)).first(),
    page.getByText(new RegExp(`^\\s*${targetDay}\\s*$`)).first(),
  ], 1500);

  if (dayButton) {
    await dayButton.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }

  const nextButton = await firstVisible([
    page.getByRole("button", { name: /next|siguiente|›|»/i }).first(),
    page.locator("button[aria-label*='Next' i], button[aria-label*='Siguiente' i]").first(),
  ], 600);

  if (nextButton) {
    await nextButton.click();
    await page.waitForTimeout(300);
    const nextMonthDay = await firstVisible([
      page.getByRole("button", { name: new RegExp(`^${targetDay}$`) }).first(),
      page.locator("button, [role='button'], .ngb-dp-day").filter({ hasText: new RegExp(`^\\s*${targetDay}\\s*$`) }).first(),
      page.locator("ngb-datepicker, .ngb-dp-month, .dropdown-menu, .datepicker").getByText(new RegExp(`^\\s*${targetDay}\\s*$`)).first(),
      page.getByText(new RegExp(`^\\s*${targetDay}\\s*$`)).first(),
    ], 1000);
    if (nextMonthDay) {
      await nextMonthDay.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
  }

  return false;
}

async function topDateControlButton() {
  const buttons = page.locator("button, a, [role='button'], .btn");
  const count = await buttons.count();
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await isVisible(button, 100))) continue;
    const box = await button.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.y < 60 || box.y > 180 || box.x < 350 || box.x > 900 || box.width > 80 || box.height > 80) continue;
    candidates.push({ button, x: box.x, y: box.y });
  }

  candidates.sort((a, b) => a.y - b.y || b.x - a.x);
  if (!candidates.length && booleanEnv("GOLF_DEBUG_BUTTONS", false)) {
    const debug = [];
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      const box = await button.boundingBox().catch(() => null);
      if (!box) continue;
      debug.push({ index, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) });
    }
    console.log("Botones visibles:", JSON.stringify(debug.slice(0, 40)));
  }
  return candidates[0]?.button || null;
}

async function findSlot() {
  if (config.time) {
    const exactTime = new RegExp(`(^|\\D)${escapeRegExp(config.time)}(\\D|$)`);
    const candidates = [
      page.getByRole("button", { name: exactTime }).first(),
      page.getByRole("link", { name: exactTime }).first(),
      page.locator("button, a, td, div").filter({ hasText: exactTime }).first(),
    ];

    for (const candidate of candidates) {
      if (await isVisible(candidate, 2000)) return candidate;
    }
  }

  if (config.players > 1) {
    const sameLineSlot = await bestSlotForPlayerCount(true);
    if (sameLineSlot) return sameLineSlot;

    console.log(
      `No encontré una línea con ${config.players} espacios dentro del rango; busco una línea libre en cualquier horario del día.`,
    );
    const sameLineFallback = await bestSlotForPlayerCount(false);
    if (sameLineFallback) return sameLineFallback;
  }

  const slot = await earliestVisibleSlotInWindow(page.locator(".test_cell_business"), true);
  if (slot) return slot;

  const innerSlot = await earliestVisibleSlotInWindow(page.locator(".test_cell_inner"), true);
  if (innerSlot) return innerSlot;

  const fallbackSlot = await earliestVisibleSlotInWindow(page.locator("button, a, td, div, [role='button']"), true);
  if (fallbackSlot) return fallbackSlot;

  return null;
}

async function bestSlotForPlayerCount(respectWindow) {
  const matches = await collectSlotCandidates(
    page.locator(".test_cell_business"),
    respectWindow,
    { strictAvailable: true },
  );
  const unique = uniqueSlotCandidates(matches);
  const groups = groupSlotCandidatesByLine(unique)
    .filter((group) => countDistinctColumns(group.candidates) >= config.players)
    .sort((a, b) => {
      const timeDiff = a.minutes - b.minutes;
      return timeDiff || averageScore(b.candidates) - averageScore(a.candidates) || a.y - b.y;
    });

  if (booleanEnv("GOLF_DEBUG_SLOTS", false)) {
    console.log("Líneas candidatas:", JSON.stringify(groups.slice(0, 12).map((group) => ({
      time: group.time,
      spaces: group.candidates.length,
      score: averageScore(group.candidates),
      y: Math.round(group.y),
      texts: group.candidates.slice(0, config.players).map((candidate) => candidate.text),
    })), null, 2));
  }

  for (const group of groups) {
    const topMostCandidates = [];
    for (const candidate of group.candidates) {
      await candidate.item.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(25);
      const topHit = await topHitInfo(candidate.item);
      if (topHit.isTopMost) topMostCandidates.push(candidate);
      if (countDistinctColumns(topMostCandidates) >= config.players) {
        const chosen = firstCandidatePerColumn(topMostCandidates).sort((a, b) => a.box.x - b.box.x)[0];
        const scope = respectWindow ? "dentro del rango elegido" : "fuera del rango elegido";
        console.log(`Mejor línea para ${config.players} jugadores: ${group.time} (${scope}, ${countDistinctColumns(topMostCandidates)} espacios visibles)`);
        return chosen.item;
      }
    }
  }

  return null;
}

async function earliestVisibleSlotInWindow(locator, respectWindow) {
  const unique = uniqueSlotCandidates(await collectSlotCandidates(locator, respectWindow));

  unique.sort((a, b) => b.score - a.score || a.minutes - b.minutes);
  if (booleanEnv("GOLF_DEBUG_SLOTS", false)) {
    console.log("Candidatos de turno:", JSON.stringify(unique.slice(0, 20).map((match) => ({
      time: match.time,
      score: match.score,
      text: match.text,
      box: compactBox(match.box),
      meta: match.meta,
    })), null, 2));
  }

  let rejectedLogs = 0;
  for (const match of unique) {
    await match.item.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(25);
    const topHit = await topHitInfo(match.item);
    if (!topHit.isTopMost) {
      if (booleanEnv("GOLF_DEBUG_SLOTS", false) && rejectedLogs < 20) {
        rejectedLogs += 1;
        console.log(`Descartando ${match.time} por capa superior: ${JSON.stringify(topHit)}`);
      }
      continue;
    }
    console.log(`Mejor horario visible: ${match.time} (${match.text})`);
    return match.item;
  }

  return null;
}

function uniqueSlotCandidates(matches) {
  const seen = new Set();
  const unique = [];

  for (const match of matches) {
    const key = `${match.time}:${Math.round(match.box.x / 10)}:${Math.round(match.box.y / 10)}:${match.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }

  return unique;
}

function groupSlotCandidatesByLine(candidates) {
  const groups = new Map();

  for (const candidate of candidates) {
    const yBucket = Math.round(candidate.box.y / 8);
    const key = `${candidate.time}:${yBucket}`;
    if (!groups.has(key)) {
      groups.set(key, {
        time: candidate.time,
        minutes: candidate.minutes,
        y: candidate.box.y,
        candidates: [],
      });
    }
    groups.get(key).candidates.push(candidate);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    candidates: group.candidates.sort((a, b) => a.box.x - b.box.x),
  }));
}

function countDistinctColumns(candidates) {
  return new Set(candidates.map(columnKey)).size;
}

function firstCandidatePerColumn(candidates) {
  const byColumn = new Map();
  for (const candidate of candidates) {
    const key = columnKey(candidate);
    const current = byColumn.get(key);
    if (!current || candidate.box.x < current.box.x) byColumn.set(key, candidate);
  }
  return [...byColumn.values()];
}

function columnKey(candidate) {
  return Math.round(candidate.box.x / 120);
}

function averageScore(candidates) {
  if (!candidates.length) return 0;
  return candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length;
}

async function collectSlotCandidates(locator, respectWindow = true, options = {}) {
  const matches = [];
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await isVisible(item, 200))) continue;
    if (await isDisabled(item)) continue;

    const text = normalizeSpaces((await item.innerText().catch(() => "")) || "");
    if (!isLikelySlotText(text)) continue;
    const box = await item.boundingBox().catch(() => null);
    if (!isLikelySlotBox(box)) continue;
    const time = firstTimeInText(text);
    if (!time || (respectWindow && !isTimeInWindow(time))) continue;
    const meta = await item.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        className: String(element.className || ""),
        backgroundColor: style.backgroundColor,
        childIcons: element.querySelectorAll("i, svg").length,
        childButtons: element.querySelectorAll("button, a, [role='button']").length,
      };
    }).catch(() => ({}));
    if (options.strictAvailable && !isStrictAvailableSlot(meta)) continue;
    matches.push({
      item,
      time,
      minutes: timeToMinutes(time),
      text,
      score: slotScore(text, meta),
      box,
      meta,
    });
  }

  return matches;
}


async function topHitInfo(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    const topBusiness = top?.closest?.(".test_cell_business");
    const topInner = top?.closest?.(".test_cell_inner");
    return {
      isTopMost: top === element || topBusiness === element || topInner === element,
      topTag: top?.tagName || "",
      topClassName: String(top?.className || ""),
      topText: String(top?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    };
  }).catch(() => ({ isTopMost: false }));
}

function isStrictAvailableSlot(meta = {}) {
  const className = String(meta.className || "");
  if (!/test_cell_business/i.test(className)) return false;
  if (Number(meta.childIcons || 0) > 0) return false;
  return true;
}

function isLikelySlotText(text) {
  if (!text || text.length > 140) return false;
  if (!firstTimeInText(text)) return false;
  if (/cerrado|bloqueada|caddy virtual|manual de usuario|enviar/i.test(text)) return false;
  return /practica|práctica|deportiva|feriado|\*/i.test(text);
}

function isLikelySlotBox(box) {
  if (!box) return false;
  if (box.width < 60 || box.height < 20) return false;
  if (box.width > 360 || box.height > 90) return false;
  return true;
}

function compactBox(box) {
  if (!box) return null;
  return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
}

function slotScore(text, meta = {}) {
  let score = 0;
  if (/practica|práctica/i.test(text)) score += 4;
  if (/deportiva/i.test(text)) score += 3;
  if (config.bookingText && textMatcherLoose(config.bookingText).test(text)) score += 2;
  if (/\*/.test(text)) score += 1;
  if (Number(meta.childIcons || 0) === 0) score += 6;
  if (Number(meta.childIcons || 0) > 0) score -= 12;
  return score;
}

async function isDisabled(locator) {
  try {
    return await locator.evaluate((element) => {
      return element.disabled || element.getAttribute("aria-disabled") === "true";
    });
  } catch {
    return false;
  }
}

async function confirmReservation() {
  const confirm = await firstVisible([
    page.getByRole("button", { name: /confirmar|reservar|solicitar|finalizar|guardar/i }),
    page.locator("button").filter({ hasText: /confirmar|reservar|solicitar|finalizar|guardar/i }).first(),
  ]);

  if (!confirm) {
    throw new Error("Seleccioné el turno, pero no encontré botón de confirmación.");
  }

  await confirm.click();

  const secondConfirm = await firstVisible([
    page.getByRole("button", { name: /sí|si|confirmar|aceptar/i }),
    page.locator("button").filter({ hasText: /sí|si|confirmar|aceptar/i }).first(),
  ], 2500);
  if (secondConfirm) await secondConfirm.click();

  await page.waitForLoadState("networkidle").catch(() => {});
}

async function capture(name) {
  const file = path.join(config.outputDir, `${timestamp()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  console.log(`Screenshot: ${file}`);
}

async function firstVisible(locators, timeout = 1500) {
  for (const locator of locators) {
    if (await isVisible(locator, timeout)) return locator;
  }
  return null;
}

async function isVisible(locator, timeout) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name}. Creá .env.golf a partir de .env.golf.example.`);
  }
  return value;
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function booleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "si", "sí"].includes(value.trim().replace(/^["']|["']$/g, "").toLowerCase());
}

function assertTargetDay() {
  if (!config.enforceAllowedDays) return;

  const date = dateFromIso(config.date);
  const day = date.getDay();
  if (config.allowedTargetDays.includes(day)) return;

  const allowed = config.allowedTargetDays.map(dayName).join(", ");
  throw new Error(
    `La fecha objetivo ${config.date} cae ${dayName(day)}. La rutina está configurada para reservar solo: ${allowed}.`,
  );
}

function targetDateFromOffset() {
  const offsetDays = Number(env("GOLF_DATE_OFFSET_DAYS", "3"));
  return formatIsoDate(addDays(new Date(), offsetDays));
}

function parseAllowedDays(value) {
  return value
    .split(",")
    .map((day) => Number(day.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function parseList(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePlayerData(rawPlayerData, rawMemberIds) {
  if (rawPlayerData) {
    try {
      const parsed = JSON.parse(rawPlayerData);
      if (Array.isArray(parsed)) {
        return parsed
          .map((player) => ({
            memberId: String(player.memberId || player.matricula || "").trim(),
            documentId: String(player.documentId || player.dni || "").trim(),
          }))
          .filter((player) => player.memberId);
      }
    } catch {
      console.log("No pude leer GOLF_PLAYERS_DATA; uso GOLF_MEMBER_IDS.");
    }
  }

  return parseList(rawMemberIds).map((memberId) => ({ memberId, documentId: "" }));
}

function firstTimeInText(text) {
  const match = text.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function isTimeInWindow(time) {
  const minutes = timeToMinutes(time);
  return minutes >= timeToMinutes(config.timeWindowStart) && minutes <= timeToMinutes(config.timeWindowEnd);
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateHeadingMatcher(value) {
  const date = dateFromIso(value);
  const day = date.getDate();
  const month = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ][date.getMonth()];
  return new RegExp(`\\b${day}\\s+${month}\\s+${date.getFullYear()}\\b`, "i");
}

function dayName(day) {
  return ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][day] || String(day);
}

function normalizeSpaces(value) {
  return value.replace(/\s+/g, " ").trim();
}

function textMatcher(text) {
  return new RegExp(escapeRegExp(text), "i");
}

function textMatcherLoose(text) {
  const words = normalizeSpaces(text)
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .map(escapeRegExp);
  return new RegExp(words.join("|") || "$.", "i");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
