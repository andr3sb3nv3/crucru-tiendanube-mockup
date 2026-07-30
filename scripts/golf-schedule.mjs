export function isExecutionTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value || ""));
}

export function localDateTime(date, time) {
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

export function shiftIsoDate(value, days) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function executionPrecedesBookingOpen(runAtLocal, bookingOpenDate, bookingOpenTime = "08:00") {
  const execution = dateTimeFromLocal(runAtLocal);
  const opening = dateTimeFromLocal(localDateTime(bookingOpenDate, bookingOpenTime));
  if (!execution || !opening) return false;
  return execution.getTime() < opening.getTime();
}

export function reservationIsDue(reservation, now, prewarmMs = 0) {
  const runAt = reservationRunAt(reservation);
  if (!runAt) return false;
  const leadMs = reservation.runMode === "manual" || reservation.scheduleKind === "exact" || reservation.mode === "development"
    ? 0
    : prewarmMs;
  return runAt.getTime() - leadMs <= now.getTime();
}

export function reservationRunAt(reservation) {
  if (reservation.runAtLocal) return dateTimeFromLocal(reservation.runAtLocal);
  if (reservation.runDate && reservation.runTime) {
    return dateTimeFromLocal(localDateTime(reservation.runDate, reservation.runTime));
  }
  if (reservation.bookingOpenDate) return dateTimeFromLocal(`${reservation.bookingOpenDate}T08:00:00`);
  return null;
}

function dateTimeFromLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
}
