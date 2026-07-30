export function calendarMonthFromTitle(value) {
  const match = String(value || "").replace(/\s+/g, " ").trim().toLowerCase()
    .match(/^([a-záéíóúñ]+)\s+(\d{4})$/i);
  if (!match) return null;

  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const month = months.indexOf(match[1]);
  if (month === -1) return null;
  return { month, year: Number(match[2]) };
}
