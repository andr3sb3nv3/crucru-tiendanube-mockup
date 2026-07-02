import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SITE_URL = "https://crucru3.mitiendanube.com";
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const ASSET_DIR = path.join(ROOT, "public", "assets", "products");

const featuredCopy = {
  "alpargata-yute-uumqx": "Alpargata de yute con textura protagonista y talles del 36 al 45.",
  "alpargata-yute-icon-15pom": "Base cómoda, print expresivo y espíritu de edición limitada.",
  "alpargata-yute-feline-6lyx9": "Animal print con terminación artesanal para sumar textura al look.",
  "alpargata-yute-tiger-1j36r": "Una pieza liviana con impacto visual y disponibilidad acotada.",
  "alpargata-yute-safari-n4daw": "Yute y estampa safari para una silueta simple con personalidad.",
  "saco-nido": "Saco amplio y envolvente disponible en tonos chocolate, natural, gris y degradé.",
  "sacon-nube": "Volumen suave, silueta cómoda y colores neutros para uso cotidiano.",
  "sweater-x7zuc": "Tejido con pelo, textura selva y calce relajado en talles M y L.",
  "bota-salvaje": "Bota de carácter fuerte para combinar con capas y prendas de invierno.",
  "slippers-salvaje-3jl4n": "Slippers con variantes de color y print para uso diario.",
};

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

function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(url = "") {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${SITE_URL}${url}`;
  return url;
}

function slugFromUrl(url) {
  return new URL(url).pathname.split("/").filter(Boolean).pop();
}

function categoryFor(name) {
  const normalized = name.toLowerCase();
  if (normalized.includes("saco") || normalized.includes("sacon")) return "abrigos";
  if (normalized.includes("sweater")) return "tejidos";
  return "calzado";
}

function tagFor(name) {
  const normalized = name.toLowerCase();
  if (normalized.includes("mohair")) return "Mohair";
  if (normalized.includes("bota")) return "Botas";
  if (normalized.includes("saco")) return "Abrigo";
  if (normalized.includes("slippers")) return "Cómodo";
  if (normalized.includes("safari")) return "Safari";
  if (normalized.includes("tiger") || normalized.includes("feline")) return "Print";
  if (normalized.includes("hero")) return "Nuevo";
  return "Yute";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseSitemap(xml) {
  const urls = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block[1].match(/<loc>(.*?)<\/loc>/)?.[1];
    if (!loc || !loc.includes("/productos/") || loc.endsWith("/productos/")) continue;
    urls.push(decodeHtml(loc));
  }
  return urls;
}

function parseVariants(html) {
  const match = html.match(/LS\.variants\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];

  try {
    return JSON.parse(match[1]).map((variant) => ({
      productId: variant.product_id,
      id: variant.id,
      available: Boolean(variant.available),
      stock: variant.stock,
      price: variant.price_short,
      option0: variant.option0,
      option1: variant.option1,
      option2: variant.option2,
      imageUrl: absoluteUrl(variant.image_url),
    }));
  } catch {
    return [];
  }
}

function parseImages(html, sitemapImages = []) {
  const fromProductSlider = [...html.matchAll(/data-srcset=['"]([^'"]+)['"][^>]*class="[^"]*js-product-slide-img/g)]
    .flatMap(([, srcset]) => srcset.split(","))
    .map((item) => absoluteUrl(item.trim().split(/\s+/)[0]))
    .filter((url) => url.includes("/products/"))
    .map((url) => url.replace(/-\d+-0\.webp/, "-1024-1024.webp"));

  return unique([...sitemapImages, ...fromProductSlider]);
}

function parseProduct(html, url, sitemapImages = []) {
  const slug = slugFromUrl(url);
  const name = stripTags(html.match(/class="[^"]*js-product-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/)?.[1] ?? "");
  const metaDescription = decodeHtml(
    html.match(/<meta name="description" content="([^"]*)"/)?.[1] ??
      html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ??
      "",
  );
  const variants = parseVariants(html);
  const firstAvailable = variants.find((variant) => variant.available) ?? variants[0];
  const price =
    firstAvailable?.price ??
    decodeHtml(html.match(/<meta property="tiendanube:price" content="([^"]*)"/)?.[1] ?? "");
  const images = parseImages(html, sitemapImages);
  const options = {
    option0: unique(variants.map((variant) => variant.option0)),
    option1: unique(variants.map((variant) => variant.option1)),
    option2: unique(variants.map((variant) => variant.option2)),
  };

  return {
    id: firstAvailable?.id ?? slug,
    productId: variants[0]?.productId,
    slug,
    sourceUrl: url,
    localUrl: `/productos/${slug}/`,
    name,
    price,
    category: categoryFor(name),
    tag: tagFor(name),
    description: featuredCopy[slug] ?? metaDescription,
    sourceDescription: metaDescription,
    images,
    image: images[0] ?? firstAvailable?.imageUrl ?? "",
    variants,
    options,
    availableVariants: variants.filter((variant) => variant.available).length,
  };
}

async function download(url, destination) {
  if (existsSync(destination)) return;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(ASSET_DIR, { recursive: true });

  const sitemapResponse = await fetch(`${SITE_URL}/sitemap.xml`);
  if (!sitemapResponse.ok) throw new Error(`Sitemap no disponible: ${sitemapResponse.status}`);
  const sitemapXml = await sitemapResponse.text();
  const productUrls = parseSitemap(sitemapXml);
  const sitemapImageMap = new Map();

  for (const block of sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block[1].match(/<loc>(.*?)<\/loc>/)?.[1];
    if (!loc || !loc.includes("/productos/") || loc.endsWith("/productos/")) continue;
    const images = [...block[1].matchAll(/<image:loc>(.*?)<\/image:loc>/g)].map(([, image]) => decodeHtml(image));
    sitemapImageMap.set(decodeHtml(loc), images);
  }

  const products = [];

  for (const url of productUrls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Producto no disponible ${url}: ${response.status}`);
    const html = await response.text();
    const product = parseProduct(html, url, sitemapImageMap.get(url) ?? []);

    product.localImages = [];
    for (const [index, imageUrl] of product.images.entries()) {
      const extension = path.extname(new URL(imageUrl).pathname) || ".webp";
      const filename = `${product.slug}-${String(index + 1).padStart(2, "0")}${extension}`;
      const destination = path.join(ASSET_DIR, filename);
      await download(imageUrl, destination);
      product.localImages.push(`/public/assets/products/${filename}`);
    }
    product.localImage = product.localImages[0] ?? "";
    products.push(product);
    console.log(`Scraped ${product.name} (${product.images.length} imágenes, ${product.variants.length} variantes)`);
  }

  products.sort((a, b) => a.name.localeCompare(b.name, "es"));

  const payload = {
    scrapedAt: new Date().toISOString(),
    source: SITE_URL,
    routes: {
      home: "/",
      products: "/productos/",
      contact: "/contacto/",
      sizeGuide: "/guia-de-talles/",
    },
    products,
  };

  await writeFile(path.join(DATA_DIR, "products.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Listo: ${products.length} productos guardados en data/products.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
