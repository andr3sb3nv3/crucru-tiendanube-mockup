import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

process.env.TZ = "America/Argentina/Buenos_Aires";
loadEnvFile(".env.golf");

const players = parsePlayers();
const config = {
  siteName: env("JOCKEY_SITE_NAME", "JOCKEY"),
  url: env("JOCKEY_URL", "https://golf.e-jockeyclub.org.ar/golf/login.php"),
  username: env("JOCKEY_USERNAME", players[0]?.memberId || ""),
  password: env("JOCKEY_PASSWORD", env("JOCKEY_USERNAME", players[0]?.memberId || "")),
  date: env("JOCKEY_DATE", targetDateFromOffset()),
  tournamentText: env("JOCKEY_TOURNAMENT_TEXT", "AZUL"),
  timeWindowStart: env("JOCKEY_TIME_WINDOW_START", "12:30"),
  timeWindowEnd: env("JOCKEY_TIME_WINDOW_END", "14:30"),
  confirmBooking: booleanEnv("JOCKEY_CONFIRM_BOOKING", false),
  headless: booleanEnv("JOCKEY_HEADLESS", true),
  outputDir: env("JOCKEY_OUTPUT_DIR", "outputs/jockey-agent"),
  maxAttempts: positiveNumber(env("JOCKEY_MAX_ATTEMPTS", "1"), 1),
  pollSeconds: positiveNumber(env("JOCKEY_POLL_SECONDS", "1"), 1),
  notBeforeLocal: env("JOCKEY_NOT_BEFORE_LOCAL", ""),
};

if (!players.length) throw new Error(`${config.siteName}: cargá al menos una matrícula para reservar.`);
if (players.length > 4) throw new Error(`${config.siteName}: cargá hasta 4 matrículas para una misma línea.`);
if (!config.username) throw new Error(`${config.siteName}: falta JOCKEY_USERNAME o una primera matrícula.`);
if (!config.password) throw new Error(`${config.siteName}: falta JOCKEY_PASSWORD.`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(config.date)) throw new Error(`${config.siteName}: JOCKEY_DATE debe tener formato YYYY-MM-DD.`);
if (!isTime(config.timeWindowStart) || !isTime(config.timeWindowEnd)) {
  throw new Error(`${config.siteName}: el rango horario debe tener formato HH:mm.`);
}

let lastDialogMessage = "";

await main();

async function main() {
  fs.mkdirSync(config.outputDir, { recursive: true });
  log(`Inicio del agente para jugar ${config.date}.`);
  log(`Jugadores solicitados: ${players.map((player) => player.memberId).join(", ")}.`);
  log(`Busco horario ${config.timeWindowStart}-${config.timeWindowEnd}.`);

  const browser = await chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
    page.setDefaultTimeout(30000);
    page.on("dialog", async (dialog) => {
      lastDialogMessage = dialog.message();
      log(`Aviso del sitio: ${lastDialogMessage}`);
      await dialog.accept();
    });

    await login(page);
    await waitUntilNotBefore(page);
    const slot = await findAvailableSlot(page);
    await openSlot(page, slot);
    const verifiedPlayers = await fillPlayers(page, players);

    if (!config.confirmBooking) {
      await snapshot(page, "jockey-listo-sin-confirmar");
      log("Modo prueba: jugadores verificados. No confirmo la reserva.");
      await cancelReservation(page);
      process.exitCode = 2;
      return;
    }

    await confirmReservation(page, slot, verifiedPlayers);
    await snapshot(page, "jockey-confirmado");
    log(`Reserva confirmada por el sitio de ${config.siteName}.`);
  } finally {
    await browser.close();
  }
}

async function waitUntilNotBefore(page) {
  if (!config.notBeforeLocal) return;
  const target = new Date(config.notBeforeLocal);
  if (!Number.isFinite(target.getTime())) return;

  const initialWait = target.getTime() - Date.now();
  if (initialWait <= 0) return;
  log(`Sesión preparada. Espero hasta ${config.notBeforeLocal.replace("T", " ")} para consultar los torneos.`);

  while (Date.now() < target.getTime()) {
    await page.waitForTimeout(Math.min(1000, Math.max(1, target.getTime() - Date.now())));
  }
  log("Horario de apertura alcanzado; comienzo la búsqueda.");
}

async function findAvailableSlot(page) {
  let lastError;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      log(`Busco torneo y línea disponibles (${attempt}/${config.maxAttempts}).`);
      const tournament = await selectTournament(page);
      await openTournament(page, tournament);
      return await selectSlot(page, players.length);
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxAttempts) break;
      log(`Todavía no está disponible: ${error instanceof Error ? error.message : error}`);
      await page.waitForTimeout(config.pollSeconds * 1000);
    }
  }
  throw lastError || new Error(`${config.siteName}: no encontré una reserva disponible.`);
}

async function login(page) {
  log(`Abro login de ${config.siteName}.`);
  await page.goto(config.url, { waitUntil: "domcontentloaded" });
  await snapshot(page, "login");

  log("Ingreso matrícula y clave.");
  await page.fill('input[name="username"]', config.username);
  await page.fill('input[name="password"]', config.password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    page.click('input[type="submit"]'),
  ]);

  const body = await bodyText(page);
  if (/Número de Matrícula|Clave:|Ingresar/i.test(body) && !/Inicio/i.test(body)) {
    await snapshot(page, "login-error");
    throw new Error(`${config.siteName}: no pude iniciar sesión. Revisá usuario y contraseña.`);
  }
  log("Sesión iniciada.");
}

async function selectTournament(page) {
  const listUrl = new URL("torneoshabilitadosparareservas.php", config.url).toString();
  const targetDate = jockeyDate(config.date);
  log(`Abro torneos disponibles y busco fecha ${targetDate}.`);
  await page.goto(listUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body");
  await snapshot(page, "torneos");

  const tournaments = await page.evaluate(() => {
    const rows = [];
    for (const link of document.querySelectorAll("a")) {
      const raw = `${link.getAttribute("href") || ""} ${link.getAttribute("onclick") || ""}`;
      const match = raw.match(/reservas\('([^']+)'\)/);
      if (!match) continue;
      const row = link.closest("tr");
      const text = (row?.innerText || link.innerText || "").replace(/\s+/g, " ").trim();
      const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{2})/);
      rows.push({
        id: match[1],
        text,
        date: dateMatch?.[1] || "",
        open: /abiertas/i.test(text),
        requestOnly: /a requerir/i.test(text),
      });
    }
    return rows;
  });

  const byDate = tournaments.filter((item) => item.date === targetDate && item.open && !item.requestOnly);
  if (!byDate.length) {
    const available = tournaments.map((item) => `${item.date || "s/f"} - ${item.text}`).join("\n");
    throw new Error(`${config.siteName}: no encontré torneo abierto para ${targetDate}. Disponibles:\n${available}`);
  }

  const preference = normalizeText(config.tournamentText);
  const preferred = preference
    ? byDate.find((item) => normalizeText(item.text).includes(preference))
    : null;
  const tournament = preferred || byDate[0];
  log(`Torneo elegido: ${tournament.text}`);
  return tournament;
}

async function openTournament(page, tournament) {
  const reservationUrl = new URL(
    `reservas.php?TorneoID=${encodeURIComponent(tournament.id)}&vuelta=torneoshabilitadosparareservas.php`,
    config.url,
  ).toString();
  log(`Abro grilla de reservas del torneo ${tournament.id}.`);
  await page.goto(reservationUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body");
  await snapshot(page, "grilla");
}

async function selectSlot(page, playerCount) {
  log("Leo la grilla y busco una línea con espacios libres.");
  const slots = await page.evaluate(() => {
    const result = [];
    for (const row of document.querySelectorAll("tr")) {
      const cells = [...row.children];
      const time = cells[0]?.innerText.trim();
      const hole = cells[1]?.innerText.trim();
      if (!/^\d{2}:\d{2}$/.test(time || "") || !/^(1|10)$/.test(hole || "")) continue;

      const playerCells = cells.slice(2, 6).map((cell, index) => {
        const text = cell.innerText.replace(/\s+/g, " ").trim();
        const onclick = cell.getAttribute("onclick") || "";
        return {
          slot: index + 1,
          text,
          onclick,
          free: /altaReserva/.test(onclick) && !/reservándose|reservandose/i.test(text),
        };
      });
      const freeCells = playerCells.filter((cell) => cell.free);
      if (!freeCells.length) continue;
      result.push({
        time,
        hole,
        free: freeCells.length,
        onclick: freeCells[0].onclick,
        playerCells,
      });
    }
    return result;
  });

  const start = timeToMinutes(config.timeWindowStart);
  const end = timeToMinutes(config.timeWindowEnd);
  const enoughSpace = slots.filter((slot) => slot.free >= playerCount);
  const inWindow = enoughSpace.filter((slot) => {
    const minutes = timeToMinutes(slot.time);
    return minutes >= start && minutes <= end;
  });

  const candidates = inWindow.length ? inWindow : enoughSpace;
  if (!candidates.length) {
    const summary = slots.map((slot) => `${slot.time} hoyo ${slot.hole}: ${slot.free} libres`).join("\n");
    throw new Error(`${config.siteName}: no encontré una línea con ${playerCount} espacios libres. Líneas con algún lugar:\n${summary}`);
  }

  candidates.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time) || Number(a.hole) - Number(b.hole));
  const selected = candidates[0];
  if (!inWindow.length) {
    log(`No había línea completa dentro del rango. Uso alternativa ${selected.time} hoyo ${selected.hole}.`);
  } else {
    log(`Encontré línea ${selected.time} hoyo ${selected.hole} con ${selected.free} espacios libres.`);
  }
  return selected;
}

async function openSlot(page, slot) {
  log(`Abro formulario de reserva para ${slot.time} hoyo ${slot.hole}.`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    page.evaluate((selected) => {
      for (const row of document.querySelectorAll("tr")) {
        const cells = [...row.children];
        const time = cells[0]?.innerText.trim();
        const hole = cells[1]?.innerText.trim();
        if (time !== selected.time || hole !== selected.hole) continue;

        const freeCell = cells.slice(2, 6).find((cell) => {
          const text = cell.innerText.replace(/\s+/g, " ").trim();
          const onclick = cell.getAttribute("onclick") || "";
          return onclick === selected.onclick && !/reservándose|reservandose/i.test(text);
        });
        if (!freeCell) throw new Error("La línea elegida ya no tiene una celda libre.");
        freeCell.click();
        return;
      }
      throw new Error("No encontré la línea elegida en la grilla.");
    }, slot),
  ]);

  await page.waitForSelector('input[name^="txtID"]');
  const formSlots = await availableFormSlots(page);
  if (formSlots.length < players.length) {
    throw new Error(`${config.siteName}: el formulario abrió con ${formSlots.length} espacios libres, pero necesito ${players.length}.`);
  }
  log(`Formulario abierto. Espacios a completar: ${formSlots.map((slotNumber) => slotNumber).join(", ")}.`);
}

async function fillPlayers(page, selectedPlayers) {
  const formSlots = await availableFormSlots(page);
  const verifiedPlayers = [];
  for (let index = 0; index < selectedPlayers.length; index += 1) {
    const slotNumber = formSlots[index];
    const player = selectedPlayers[index];
    log(`Completo jugador ${index + 1}: matrícula ${player.memberId}.`);
    await page.fill(`input[name="txtID${slotNumber}"]`, player.memberId);
    await page.fill(`input[name="txtName${slotNumber}"]`, "");

    const verifyButton = page.locator(`input[type="button"][onclick*="verificar(${slotNumber},"]`).first();
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
      verifyButton.click(),
    ]);
    await page.waitForTimeout(500);

    const verified = await page.evaluate((slot) => {
      const id = document.querySelector(`input[name="txtID${slot}"]`)?.value.trim() || "";
      const name = document.querySelector(`input[name="txtName${slot}"]`)?.value.trim() || "";
      return { id, name };
    }, slotNumber);

    if (!verified.id || !verified.name) {
      throw new Error(`${config.siteName}: no pude verificar la matrícula ${player.memberId}${lastDialogMessage ? ` (${lastDialogMessage})` : ""}.`);
    }
    log(`Verificado: ${verified.id} - ${verified.name}.`);
    verifiedPlayers.push({ ...player, ...verified, slotNumber });
  }
  return verifiedPlayers;
}

async function confirmReservation(page, slot, verifiedPlayers) {
  log("Confirmo reserva(s) en el sitio.");
  const button = page.locator('input#Agregar, input[type="button"][value*="Confirmar"]').first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    button.click(),
  ]);
  await page.waitForTimeout(1500);

  const body = await bodyText(page);
  if (/Tiempo para realizar la reserva/i.test(body)) {
    await snapshot(page, "confirmacion-pendiente");
    throw new Error(`${config.siteName}: el sitio siguió en el formulario después de confirmar. Revisá la última captura.`);
  }

  await assertPlayersInFinalGrid(page, slot, verifiedPlayers);
}

async function assertPlayersInFinalGrid(page, slot, verifiedPlayers) {
  log(`Verifico que la línea final ${slot.time} hoyo ${slot.hole} tenga todos los jugadores.`);
  const finalLine = await page.evaluate((selected) => {
    for (const row of document.querySelectorAll("tr")) {
      const cells = [...row.children];
      const time = cells[0]?.innerText.trim();
      const hole = cells[1]?.innerText.trim();
      if (time !== selected.time || hole !== selected.hole) continue;
      return {
        time,
        hole,
        players: cells.slice(2, 6).map((cell) => cell.innerText.replace(/\s+/g, " ").trim()),
      };
    }
    return null;
  }, slot);

  if (!finalLine) {
    await snapshot(page, "linea-final-no-encontrada");
    throw new Error(`${config.siteName}: confirmé, pero no encontré la línea ${slot.time} hoyo ${slot.hole} para validar.`);
  }

  const finalText = normalizeText(finalLine.players.join(" "));
  const missing = verifiedPlayers.filter((player) => {
    const id = normalizeText(player.id || player.memberId);
    const name = normalizeText(player.name);
    const nameTokens = name.split(/\s+/).filter((token) => token.length > 2);
    const nameMatch = nameTokens.slice(0, 2).every((token) => finalText.includes(token));
    return !(id && finalText.includes(id)) && !nameMatch;
  });

  log(`Línea final: ${finalLine.players.filter(Boolean).join(" | ")}`);
  if (missing.length) {
    await snapshot(page, "jugadores-faltantes");
    throw new Error(`${config.siteName}: la línea se confirmó, pero no encontré a: ${missing.map((player) => `${player.memberId} ${player.name || ""}`.trim()).join(", ")}.`);
  }
}

async function cancelReservation(page) {
  log("Cancelo el formulario de prueba para liberar la línea.");
  const cancelButton = page.locator('input[type="button"][value="Cancelar"]').first();
  if (await cancelButton.count()) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
      cancelButton.click(),
    ]);
    await page.waitForTimeout(500);
    log("Formulario cancelado.");
  }
}

async function availableFormSlots(page) {
  return page.evaluate(() => [1, 2, 3, 4].filter((slot) => {
    const id = document.querySelector(`input[name="txtID${slot}"]`)?.value.trim() || "";
    const name = document.querySelector(`input[name="txtName${slot}"]`)?.value.trim() || "";
    return !id && !name;
  }));
}

async function snapshot(page, name) {
  const stamp = new Date().toISOString().replace(/[^\dT]/g, "").slice(0, 15);
  const filePath = path.join(config.outputDir, `${stamp}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => null);
  log(`Captura: ${filePath}`);
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

function parsePlayers() {
  const json = env("JOCKEY_PLAYERS_DATA", "");
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        const playersFromJson = parsed
          .map((player) => ({ memberId: String(player.memberId || "").trim(), documentId: String(player.documentId || "").trim() }))
          .filter((player) => player.memberId);
        if (playersFromJson.length) return playersFromJson;
      }
    } catch {
      // Fall back to JOCKEY_MEMBER_IDS.
    }
  }

  const memberIds = env("JOCKEY_MEMBER_IDS", "")
    .split(/[\s,;]+/)
    .map((memberId) => memberId.trim())
    .filter(Boolean);
  return memberIds.map((memberId) => ({ memberId, documentId: "" }));
}

function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function booleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "si", "sí"].includes(value.toLowerCase());
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function jockeyDate(isoDate) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${day}/${month}/${year.slice(2)}`;
}

function targetDateFromOffset() {
  const date = new Date();
  date.setDate(date.getDate() + Number(env("JOCKEY_DATE_OFFSET_DAYS", "2")));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function log(message) {
  console.log(`${config.siteName}: ${message}`);
}
