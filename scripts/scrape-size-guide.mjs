import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://crucru3.mitiendanube.com/guia-de-talles/";
const ROOT = process.cwd();

function decodeHtml(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, entity) => named[entity] ?? `&${entity};`)
    .replace(/\s+/g, " ")
    .trim();
}

function textFromHtml(html = "") {
  return decodeHtml(html.replace(/<[^>]+>/g, " "));
}

function parseTable(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, rowHtml]) =>
    [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cellHtml]) => textFromHtml(cellHtml)),
  );

  return {
    headers: rows[0] ?? [],
    rows: rows.slice(1),
  };
}

function parseSections(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((match) => match[0]);
  const titles = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/g)]
    .map(([, title]) => textFromHtml(title))
    .filter((title) => ["Remeras", "Pantalones", "Calzado"].includes(title));

  return tables.map((table, index) => ({
    title: titles[index] ?? `Tabla ${index + 1}`,
    note: "Todas las medidas están expresadas en centímetros.",
    ...parseTable(table),
  }));
}

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`No se pudo scrapear la guía de talles: ${response.status}`);
}

const html = await response.text();
const sections = parseSections(html);
const pageDescription = decodeHtml(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "");

await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(
  path.join(ROOT, "data", "size-guide.json"),
  `${JSON.stringify(
    {
      scrapedAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
      description: pageDescription,
      disclaimer:
        "Las medidas incluidas son de referencia. Para producción, conviene reemplazarlas por medidas validadas por Crucru para cada producto.",
      sections,
    },
    null,
    2,
  )}\n`,
);

console.log(`Guía de talles scrapeada: ${sections.length} tablas guardadas en data/size-guide.json`);
