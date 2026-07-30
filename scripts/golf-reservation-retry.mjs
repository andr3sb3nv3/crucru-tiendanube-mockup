export const RESERVATION_WRITE_STARTED_MARKER = "Reserva: comenzó el envío al sitio.";

export function scheduledRetryPlan(reservation, result, options = {}) {
  const retryTime = String(options.retryTime || "07:10");
  const maxRetries = positiveNumber(options.maxRetries, 1);
  const retryCount = Number(reservation.scheduledRetryCount || 0);
  const retryDate = String(reservation.bookingOpenDate || reservation.runDate || "");

  if (result.status !== "failed") return null;
  if (reservation.mode !== "production" || reservation.runMode !== "scheduled") return null;
  if (reservation.scheduleKind === "exact") return null;
  if (reservation.target !== "golf-tracker") return null;
  if (result.reservationWriteStarted || reservation.reservationWriteStarted) return null;
  if (retryCount >= maxRetries) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retryDate) || !isTime(retryTime)) return null;

  return {
    retryDate,
    retryTime,
    retryAtLocal: `${retryDate}T${retryTime}:00`,
    retryNumber: retryCount + 1,
    reason: trimReason(result.stderr || result.stdout || "El agente terminó antes de enviar la reserva."),
  };
}

export function applyScheduledRetry(current, plan) {
  const message = `Reintento automático ${plan.retryNumber} programado para ${plan.retryDate} ${plan.retryTime}; el intento anterior terminó antes de enviar la reserva.\n`;
  return {
    ...current,
    status: "pending",
    runMode: "scheduled",
    runDate: plan.retryDate,
    runTime: plan.retryTime,
    runAtLocal: plan.retryAtLocal,
    scheduledRetryCount: plan.retryNumber,
    scheduledRetryReason: plan.reason,
    reservationWriteStarted: false,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    heartbeatAt: null,
    workerId: null,
    lastError: null,
    lastStderr: "",
    lastStdout: `${String(current.lastStdout || "")}${message}`.slice(-12000),
  };
}

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function trimReason(value) {
  return String(value || "").trim().slice(-1000);
}
