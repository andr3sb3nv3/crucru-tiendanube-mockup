import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ASSET_VERSION = "20260702-dock-toggle";
const SITE_BASE_PATH = normalizeBasePath(process.env.SITE_BASE_PATH || "");
const data = JSON.parse(await readFile(path.join(ROOT, "data", "products.json"), "utf8"));
const products = data.products;
const sizeGuide = JSON.parse(await readFile(path.join(ROOT, "data", "size-guide.json"), "utf8"));

function normalizeBasePath(value = "") {
  const trimmed = String(value).trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function withBasePath(html) {
  if (!SITE_BASE_PATH) return html;
  return html.replace(/\b(href|src|poster)="\/(?!\/)/g, `$1="${SITE_BASE_PATH}/`);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function relAsset(pathname) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function pageShell({ title, description, body, extraScript = "" }) {
  return withBasePath(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Tenor+Sans&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}" />
  </head>
  <body>
    <div class="announcement">
      <div class="announcement-track">
        <span>3 cuotas sin interés</span>
        <span>15% off por transferencia</span>
        <span>Envíos a todo el país</span>
        <span>3 cuotas sin interés</span>
        <span>15% off por transferencia</span>
        <span>Envíos a todo el país</span>
        <span>3 cuotas sin interés</span>
        <span>15% off por transferencia</span>
        <span>Envíos a todo el país</span>
      </div>
    </div>
    <header class="site-header">
      <a class="brand" href="/" aria-label="Crucru inicio">crucru</a>
      <nav class="nav-links" aria-label="Navegación principal">
        <a href="/productos/">Productos</a>
        <a href="/#drop">Drop invierno</a>
        <a href="/contacto/">Contacto</a>
        <a href="/guia-de-talles/">Guía de talles</a>
        <a href="/propuesta/">Propuesta</a>
      </nav>
      <div class="header-actions">
        <a class="ghost-link" href="https://www.instagram.com/crucruargentina" target="_blank" rel="noreferrer">Instagram</a>
        <button class="cart-button" type="button" aria-label="Abrir carrito"><span>Carrito</span><strong>0</strong></button>
      </div>
    </header>
    ${body}
    <footer class="footer" id="contacto">
      <div class="footer-about">
        <a class="brand footer-brand" href="/">crucru</a>
        <p>Indumentaria y calzado con textura, compra online simple y atención directa.</p>
        <span>Mockup preparado para continuidad sobre Tiendanube.</span>
      </div>
      <div class="footer-links">
        <div>
          <strong>Comprar</strong>
          <a href="/productos/">Productos</a>
          <a href="/guia-de-talles/">Guía de talles</a>
          <a href="/contacto/">Contacto</a>
        </div>
        <div>
          <strong>Canales</strong>
          <a href="https://wa.me/5491155787296" target="_blank" rel="noreferrer">WhatsApp</a>
          <a href="https://www.instagram.com/crucruargentina" target="_blank" rel="noreferrer">Instagram</a>
          <a href="https://crucru3.mitiendanube.com/" target="_blank" rel="noreferrer">Tienda actual</a>
        </div>
      </div>
    </footer>
    <section class="worldcup-modal" id="worldcupModal" aria-hidden="true" aria-label="Activación Mundial Crucru">
      <div class="worldcup-modal-panel">
        <button class="worldcup-close" type="button" data-worldcup-close aria-label="Cerrar activación">×</button>
        <div class="worldcup-wheel-wrap" aria-hidden="true">
          <div class="wheel-pointer"></div>
          <div class="worldcup-wheel" id="worldcupWheel">
            <span class="wheel-label label-a">15% OFF</span>
            <span class="wheel-label label-b">Envío bonificado</span>
            <span class="wheel-label label-c">10% OFF</span>
            <span class="wheel-label label-d">Sorteo</span>
            <span class="wheel-label label-e">5% OFF</span>
            <span class="wheel-label label-f">Copa Crucru</span>
            <div class="wheel-center">
              <strong>Copa</strong>
              <small>del Mundo</small>
            </div>
          </div>
        </div>
        <div class="worldcup-modal-copy">
          <p class="eyebrow">Activación Mundial</p>
          <h2>Girás, participás y comprás con premio.</h2>
          <p>Campaña propuesta para Crucru: pop-up promocional con estética Argentina, ruleta de beneficios y sorteo para empujar ventas durante fechas mundialistas.</p>
          <form class="worldcup-form">
            <label>Email<input type="email" placeholder="tuemail@email.com" /></label>
            <button type="submit">Jugar ahora</button>
          </form>
          <p class="worldcup-result" id="worldcupResult">Premios sugeridos: descuentos, envío bonificado o participación por una orden de compra.</p>
          <button class="worldcup-skip" type="button" data-worldcup-close>No, gracias</button>
        </div>
      </div>
    </section>
    <div class="floating-dock" aria-label="Acciones de presentación">
      <button class="dock-toggle" type="button" aria-label="Minimizar acciones" aria-expanded="true" data-dock-toggle>−</button>
      <div class="variant-actions" aria-label="Variantes visuales">
        <button type="button" data-design-option="one">Opción 1</button>
        <button type="button" data-design-option="two">Opción 2</button>
        <button type="button" data-design-option="three">Opción 3</button>
      </div>
      <div class="dock-secondary-actions">
        <a class="worldcup-action" href="/propuesta/#activacion-mundial" data-open-worldcup>Activación Mundial</a>
        <a class="proposal-action" href="/propuesta/">Propuesta</a>
      </div>
    </div>
    <script>
      (() => {
        const queryDesign = new URLSearchParams(window.location.search).get("design");
        const allowedDesigns = ["one", "two", "three"];
        const saved = allowedDesigns.includes(queryDesign)
          ? queryDesign
          : localStorage.getItem("crucru-design-option") || "one";
        const apply = (value) => {
          document.body.dataset.design = value;
          localStorage.setItem("crucru-design-option", value);
          document.querySelectorAll("[data-design-option]").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.designOption === value);
          });
        };
        apply(saved);
        document.addEventListener("click", (event) => {
          const button = event.target.closest("[data-design-option]");
          if (button) apply(button.dataset.designOption);
        });
      })();
      (() => {
        const dock = document.querySelector(".floating-dock");
        const toggle = document.querySelector("[data-dock-toggle]");
        if (!dock || !toggle) return;
        const applyDockState = (minimized) => {
          dock.classList.toggle("is-minimized", minimized);
          toggle.textContent = minimized ? "+" : "−";
          toggle.setAttribute("aria-label", minimized ? "Maximizar acciones" : "Minimizar acciones");
          toggle.setAttribute("aria-expanded", String(!minimized));
          localStorage.setItem("crucru-dock-minimized", minimized ? "true" : "false");
        };
        applyDockState(localStorage.getItem("crucru-dock-minimized") === "true");
        toggle.addEventListener("click", () => {
          applyDockState(!dock.classList.contains("is-minimized"));
        });
      })();
      (() => {
        const modal = document.getElementById("worldcupModal");
        const wheel = document.getElementById("worldcupWheel");
        const result = document.getElementById("worldcupResult");
        if (!modal || !wheel || !result) return;
        const open = () => {
          modal.classList.add("is-open");
          modal.setAttribute("aria-hidden", "false");
        };
        const close = () => {
          modal.classList.remove("is-open");
          modal.setAttribute("aria-hidden", "true");
          sessionStorage.setItem("crucru-worldcup-closed", "true");
        };
        setTimeout(() => {
          if (!sessionStorage.getItem("crucru-worldcup-closed")) open();
        }, 3500);
        document.addEventListener("click", (event) => {
          if (event.target.closest("[data-worldcup-close]")) close();
          const opener = event.target.closest("[data-open-worldcup]");
          if (opener) {
            event.preventDefault();
            open();
          }
        });
        document.querySelector(".worldcup-form")?.addEventListener("submit", (event) => {
          event.preventDefault();
          const prizes = ["15% OFF", "Envío bonificado", "10% OFF", "Participás por una orden de compra"];
          const prize = prizes[Math.floor(Math.random() * prizes.length)];
          wheel.style.transform = "rotate(" + (1080 + Math.floor(Math.random() * 360)) + "deg)";
          result.textContent = "Resultado demo: " + prize + ". En Tiendanube se puede conectar a una campaña real o cupón manual.";
        });
      })();
    </script>
    ${extraScript}
  </body>
</html>
`);
}

function productCards(items) {
  return items
    .map((product, index) => {
      const variantLabel = `${product.availableVariants} ${product.availableVariants === 1 ? "variante" : "variantes"}`;
      return `
        <article class="product-card" data-category="${escapeHtml(product.category)}">
          <a class="product-card-link" href="${product.localUrl}">
            <div class="product-media">
              <img src="${relAsset(product.localImage)}" alt="${escapeHtml(product.name)}" loading="${index < 4 ? "eager" : "lazy"}" />
              <span class="tag">${escapeHtml(product.tag)}</span>
              <span class="media-cue">Ver detalle</span>
            </div>
            <div class="product-info">
              <h3>${escapeHtml(product.name)}</h3>
              <p>${escapeHtml(product.description)}</p>
              <div class="price-row">
                <span class="price">${escapeHtml(product.price)}</span>
                <span class="installments">3 cuotas</span>
              </div>
              <div class="product-meta">
                <span>${variantLabel}</span>
                <span>${escapeHtml(product.category)}</span>
              </div>
              <div class="purchase-note">
                <span>Compra segura</span>
                <span>Consulta talle</span>
              </div>
            </div>
          </a>
          <a class="product-button" href="${product.localUrl}">Ver producto</a>
        </article>`;
    })
    .join("");
}

function monthSelection() {
  const hero = products.find((item) => item.category === "calzado") || products[0];
  const secondary = products.find((item) => item.category === "abrigos") || products[1] || hero;
  const tertiary = products.find((item) => item.category === "tejidos") || products[2] || secondary;

  return `
      <section class="month-selection" aria-label="Selección del mes">
        <a class="month-selection-media" href="${hero.localUrl}">
          <img src="${relAsset(hero.localImage)}" alt="${escapeHtml(hero.name)}" loading="lazy" />
          <span>Selección del mes</span>
        </a>
        <div class="month-selection-copy">
          <p class="eyebrow">Curaduría Crucru</p>
          <h2>Una compra más guiada, con foco en textura y uso real.</h2>
          <p>Un módulo editorial simple para destacar piezas de temporada sin salir de la estructura habitual de Tiendanube: imagen, microcopy, links a producto y atributos claros.</p>
          <div class="selection-products">
            <a href="${hero.localUrl}">
              <span>01</span>
              <strong>${escapeHtml(hero.name)}</strong>
              <small>${escapeHtml(hero.price)} · ${escapeHtml(hero.tag)}</small>
            </a>
            <a href="${secondary.localUrl}">
              <span>02</span>
              <strong>${escapeHtml(secondary.name)}</strong>
              <small>${escapeHtml(secondary.price)} · ${escapeHtml(secondary.tag)}</small>
            </a>
            <a href="${tertiary.localUrl}">
              <span>03</span>
              <strong>${escapeHtml(tertiary.name)}</strong>
              <small>${escapeHtml(tertiary.price)} · ${escapeHtml(tertiary.tag)}</small>
            </a>
          </div>
        </div>
      </section>`;
}

function categoryTiles() {
  const tiles = [
    { category: "calzado", title: "Calzado con textura", copy: "Yute, pelo y animal print para levantar looks simples." },
    { category: "abrigos", title: "Abrigos envolventes", copy: "Capas amplias, tacto suave y presencia para invierno." },
    { category: "tejidos", title: "Tejidos protagonistas", copy: "Mohair, volumen y color para sumar carácter." },
  ];

  return tiles
    .map((tile) => {
      const product = products.find((item) => item.category === tile.category) || products[0];
      return `
        <a class="category-tile" href="/productos/">
          <img src="${relAsset(product.localImage)}" alt="${escapeHtml(tile.title)}" loading="lazy" />
          <span>${escapeHtml(tile.category)}</span>
          <strong>${escapeHtml(tile.title)}</strong>
          <p>${escapeHtml(tile.copy)}</p>
        </a>`;
    })
    .join("");
}

function homePage() {
  return pageShell({
    title: "Crucru | Mockup Tiendanube",
    description: "Mockup visual para crucru, tienda de indumentaria y calzado sobre Tiendanube.",
    body: `
    <main id="inicio">
      <section class="hero" aria-label="Colección destacada">
        <img class="hero-image" src="/public/assets/brand/hero.webp" alt="Editorial de productos Crucru" />
        <div class="hero-overlay"></div>
        <div class="hero-copy">
          <p class="eyebrow">Nueva selección</p>
          <h1>crucru</h1>
          <p>Texturas nobles, siluetas relajadas y piezas con carácter para vestir todos los días con intención.</p>
          <div class="hero-actions">
            <a class="primary-link" href="/productos/">Ver productos</a>
            <a class="secondary-link" href="/#drop">Explorar invierno</a>
          </div>
        </div>
        <div class="hero-panel" aria-label="Resumen de marca">
          <span>Drop activo</span>
          <strong>Texturas de invierno</strong>
          <p>Una selección pensada para mostrar mejor materialidad, calce y disponibilidad sin salir de Tiendanube.</p>
          <div>
            <small>${products.length} productos</small>
            <small>Checkout nativo</small>
          </div>
        </div>
      </section>
      <section class="product-strip" aria-label="Beneficios de compra">
        <article>
          <small>01</small>
          <strong>Selección curada</strong>
          <span>${products.length} piezas con textura, calce cómodo y carácter propio.</span>
        </article>
        <article>
          <small>02</small>
          <strong>Compra simple</strong>
          <span>Pagos, envíos y seguimiento dentro de Tiendanube.</span>
        </article>
        <article>
          <small>03</small>
          <strong>Atención cercana</strong>
          <span>Consultas de talle y stock por WhatsApp o Instagram.</span>
        </article>
      </section>
      <section class="review-strip" aria-label="Reseñas de clientas">
        <div class="review-heading">
          <p class="eyebrow">Reviews</p>
          <h2>Lo que se tiene que sentir al comprar Crucru.</h2>
        </div>
        <div class="review-grid">
          <article>
            <span>★★★★★</span>
            <p>“La textura se ve mejor, el talle queda más claro y la compra se siente más acompañada.”</p>
            <strong>Compra de calzado</strong>
          </article>
          <article>
            <span>★★★★★</span>
            <p>“Me gusta que la tienda muestre mejor los materiales y que WhatsApp esté siempre a mano.”</p>
            <strong>Consulta por abrigo</strong>
          </article>
          <article>
            <span>★★★★★</span>
            <p>“El catálogo queda más ordenado: se entiende rápido qué mirar, qué consultar y cómo comprar.”</p>
            <strong>Experiencia online</strong>
          </article>
        </div>
      </section>
      <section class="editorial-ribbon" aria-label="Manifiesto visual Crucru">
        <span>crucru</span>
        <p>Textura noble, siluetas fáciles y una compra online que se siente más cuidada.</p>
        <small>CSS personalizado + bloques de contenido compatibles con Tiendanube</small>
      </section>
      <section class="category-rail" aria-label="Comprar por familia">
        <div class="section-heading">
          <div><p class="eyebrow">Comprar por familia</p><h2>Entradas rápidas al catálogo</h2></div>
          <a class="text-link" href="/productos/">Ver todo</a>
        </div>
        <div class="category-grid">${categoryTiles()}</div>
      </section>
      ${monthSelection()}
      <section class="collection-intro" id="drop">
        <div class="intro-media"><img src="/public/assets/brand/editorial.webp" alt="Imagen editorial de la colección Crucru" /></div>
        <div class="intro-copy">
          <p class="eyebrow">Drop invierno</p>
          <h2>Capas amplias, pelo, yute y animal print en clave urbana.</h2>
          <p>La propuesta ordena el catálogo por momentos de uso: abrigo liviano, calzado protagonista y prendas de textura.</p>
          <a href="/productos/" class="text-link">Comprar la selección</a>
        </div>
      </section>
      <section class="shop-section" id="productos">
        <div class="section-heading">
          <div><p class="eyebrow">Catálogo</p><h2>Productos destacados</h2></div>
          <a class="text-link" href="/productos/">Ver catálogo completo</a>
        </div>
        <div class="product-grid">${productCards(products.slice(0, 8))}</div>
      </section>
      <section class="brand-direction" aria-label="Dirección estética">
        <div>
          <p class="eyebrow">Dirección estética</p>
          <h2>Una tienda más editorial, sin perder operación simple.</h2>
        </div>
        <div class="direction-list">
          <article>
            <span>01</span>
            <strong>Imagen protagonista</strong>
            <p>Fotos más grandes, fondos calmos y foco en textura para que cada producto se perciba mejor.</p>
          </article>
          <article>
            <span>02</span>
            <strong>Compra guiada</strong>
            <p>Botones visibles, cuotas claras y accesos rápidos a guía de talles, contacto y checkout.</p>
          </article>
          <article>
            <span>03</span>
            <strong>Marca cercana</strong>
            <p>Mensajes simples, canales directos y una estética cuidada que no complica la gestión diaria.</p>
          </article>
        </div>
      </section>
      <section class="lookbook">
        <div class="lookbook-copy">
          <p class="eyebrow">Look completo</p>
          <h2>Una tienda con más aire, más foco y menos fricción.</h2>
          <p>El rediseño prioriza imágenes grandes, jerarquía tipográfica, precios fáciles de escanear y llamados a la acción constantes.</p>
        </div>
        <div class="lookbook-image"><img src="/public/assets/brand/texture.webp" alt="Texturas y prendas de la marca Crucru" /></div>
      </section>
      <section class="buying-flow" aria-label="Experiencia de compra">
        <div class="buying-flow-copy">
          <p class="eyebrow">Experiencia Tiendanube</p>
          <h2>Compra clara, operación conocida.</h2>
          <p>La estética mejora, pero la administración diaria sigue en la plataforma que la marca ya usa: productos, stock, pagos, envíos y pedidos dentro de Tiendanube.</p>
        </div>
        <div class="flow-steps">
          <article><span>01</span><strong>Elegí producto</strong><p>Catálogo con fotos grandes, precio visible y acceso rápido a la ficha.</p></article>
          <article><span>02</span><strong>Consultá talle</strong><p>Guía ordenada, WhatsApp visible y mensajes preparados para resolver dudas.</p></article>
          <article><span>03</span><strong>Finalizá en checkout</strong><p>Pago, envío y seguimiento siguen usando la estructura segura de Tiendanube.</p></article>
        </div>
      </section>
      <section class="fit-preview" aria-label="Acompañamiento de compra">
        <div class="fit-preview-copy">
          <p class="eyebrow">Compra acompañada</p>
          <h2>Menos duda antes de sumar al carrito.</h2>
          <p>Para indumentaria y calzado, el diferencial no es solo la estética: también es ayudar a elegir talle, entender materiales y saber por dónde consultar.</p>
          <a class="text-link" href="/guia-de-talles/">Ver guía de talles</a>
        </div>
        <div class="fit-preview-list">
          <article><span>Calce</span><strong>Medidas a mano</strong><p>Acceso directo a tablas y recomendaciones por tipo de producto.</p></article>
          <article><span>Material</span><strong>Textura visible</strong><p>Fotos grandes, video editorial y copy que explica qué hace especial a cada pieza.</p></article>
          <article><span>Consulta</span><strong>WhatsApp activo</strong><p>Un canal claro para confirmar talle, color o disponibilidad antes de comprar.</p></article>
        </div>
      </section>
      <section class="faq-section" aria-label="Preguntas frecuentes">
        <div class="faq-copy">
          <p class="eyebrow">Preguntas frecuentes</p>
          <h2>Antes de comprar</h2>
          <p>Un cierre simple para resolver dudas habituales sin sacar a la persona del recorrido de compra.</p>
        </div>
        <div class="faq-list">
          <details>
            <summary>¿Hacen envíos a todo el país?</summary>
            <p>Sí. La compra se completa desde Tiendanube y el envío se calcula durante el checkout según el código postal.</p>
          </details>
          <details>
            <summary>¿Cuáles son los medios de pago?</summary>
            <p>La tienda mantiene los medios de pago activos de Tiendanube, incluyendo tarjetas y promociones disponibles al momento de comprar.</p>
          </details>
          <details>
            <summary>¿Cómo elijo mi talle?</summary>
            <p>La ruta de guía de talles queda preparada para ordenar medidas, recomendaciones y consultas frecuentes por tipo de producto.</p>
          </details>
          <details>
            <summary>¿Hay productos por encargo?</summary>
            <p>Algunas prendas pueden tener tiempos de preparación. En esos casos conviene mostrarlo cerca del precio y reforzarlo en la ficha.</p>
          </details>
        </div>
      </section>
      <section class="material-film" aria-label="Cueros y materiales de calidad">
        <div class="material-film-copy">
          <p class="eyebrow">Materiales</p>
          <h2>Cueros, textura y terminaciones con presencia.</h2>
          <p>Un bloque sensorial para reforzar el valor táctil de la marca: superficies nobles, detalles visibles y una lectura más editorial antes de volver al catálogo.</p>
          <div class="material-points">
            <span>Video reemplazable desde archivos de Tiendanube</span>
            <span>Ideal para home, página de marca o colección</span>
            <span>Compatible con CSS personalizado y contenido HTML</span>
          </div>
        </div>
        <div class="material-video-card">
          <video autoplay muted loop playsinline poster="/public/assets/brand/material-study-poster.webp">
            <source src="/public/assets/brand/material-study.mp4" type="video/mp4" />
          </video>
          <div class="material-video-caption">
            <span>Alta calidad</span>
            <strong>Material study</strong>
          </div>
        </div>
      </section>
      <section class="brand-film" aria-label="Video institucional Crucru">
        <div class="brand-film-media">
          <video autoplay muted loop playsinline poster="/public/assets/brand/material-study-poster.webp">
            <source src="/public/assets/brand/material-study.mp4" type="video/mp4" />
          </video>
          <div class="brand-film-badge">
            <span>Crucru</span>
            <strong>Cultura de trabajo</strong>
          </div>
        </div>
        <div class="brand-film-copy">
          <p class="eyebrow">Marca y oficio</p>
          <h2>Una tienda que también cuenta cómo trabaja la marca.</h2>
          <p>Este bloque puede usarse como video institucional: proceso, selección de materiales, armado de producto, backstage o campaña. La intención es sumar confianza sin cambiar la operación de Tiendanube.</p>
          <div class="brand-film-points">
            <span>Video de proceso o campaña</span>
            <span>Copy breve de cultura de marca</span>
            <span>Implementable como bloque HTML + CSS</span>
          </div>
        </div>
      </section>
      <section class="store-cta" aria-label="Cierre de compra">
        <div>
          <p class="eyebrow">Tienda lista para evolucionar</p>
          <h2>Más presencia de marca, misma operación simple.</h2>
          <p>El mockup mejora percepción, recorrido y confianza sin mover a la marca de Tiendanube: catálogo, checkout, pagos, envíos y administración siguen en la misma plataforma.</p>
        </div>
        <div class="store-cta-actions">
          <a class="primary-link" href="/productos/">Explorar catálogo</a>
          <a class="secondary-product-link" href="/contacto/">Consultar por talle</a>
        </div>
      </section>
    </main>`,
  });
}

function productsPage() {
  return pageShell({
    title: "Productos | Crucru",
    description: "Catálogo completo de Crucru con productos scrapeados desde Tiendanube.",
    body: `
    <main>
      <section class="catalog-hero">
        <p class="eyebrow">Catálogo completo</p>
        <h1>Productos</h1>
        <p>${products.length} productos actuales de la tienda, con rutas locales equivalentes a Tiendanube.</p>
      </section>
      ${monthSelection()}
      <section class="shop-section">
        <div class="section-heading">
          <div><p class="eyebrow">Filtros</p><h2>Comprar por categoría</h2></div>
          <div class="shop-controls" aria-label="Filtros de productos">
            <button class="filter-button is-active" type="button" data-filter="all">Todo</button>
            <button class="filter-button" type="button" data-filter="calzado">Calzado</button>
            <button class="filter-button" type="button" data-filter="abrigos">Abrigos</button>
            <button class="filter-button" type="button" data-filter="tejidos">Tejidos</button>
          </div>
        </div>
        <div class="product-grid" id="productGrid">${productCards(products)}</div>
      </section>
    </main>`,
    extraScript: `<script src="/catalog.js"></script>`,
  });
}

function productPage(product) {
  const related = products.filter((item) => item.slug !== product.slug && item.category === product.category).slice(0, 4);
  const variantOptions = Object.entries(product.options)
    .filter(([, values]) => values.length)
    .map(([key, values], index) => {
      const label = key === "option0" && product.category === "calzado" ? "Talle" : index === 0 ? "Color / opción" : `Opción ${index + 1}`;
      return `<div class="variant-group"><strong>${label}</strong><div class="variant-list">${values
        .map((value) => `<span>${escapeHtml(value)}</span>`)
        .join("")}</div></div>`;
    })
    .join("");

  return pageShell({
    title: `${product.name} | Crucru`,
    description: product.sourceDescription || product.description,
    body: `
    <main>
      <nav class="product-breadcrumbs" aria-label="Ruta de navegación">
        <a href="/">Inicio</a>
        <span>/</span>
        <a href="/productos/">Productos</a>
        <span>/</span>
        <strong>${escapeHtml(product.name)}</strong>
      </nav>
      <section class="product-detail">
        <div class="product-gallery">
          ${product.localImages
            .map((image, index) => `<img src="${relAsset(image)}" alt="${escapeHtml(product.name)} ${index + 1}" loading="eager" />`)
            .join("")}
        </div>
        <article class="product-detail-info">
          <p class="eyebrow">${escapeHtml(product.category)}</p>
          <h1>${escapeHtml(product.name)}</h1>
          <p>${escapeHtml(product.sourceDescription || product.description)}</p>
          <div class="product-price-block">
            <strong>${escapeHtml(product.price)}</strong>
            <span>3 cuotas sin interés</span>
          </div>
          <div class="variant-panel">
            ${variantOptions || "<p>Producto sin variantes publicadas.</p>"}
          </div>
          <div class="stock-note">
            <strong>${product.availableVariants}</strong>
            <span>variantes disponibles según el scrape actual</span>
          </div>
          <div class="product-actions">
            <a class="primary-link" href="${product.sourceUrl}" target="_blank" rel="noreferrer">Comprar en Tiendanube</a>
            <a class="secondary-product-link" href="/productos/">Volver al catálogo</a>
          </div>
          <div class="product-trust">
            <span>Compra por Tiendanube</span>
            <span>Consulta de talle por WhatsApp</span>
            <span>Envíos a todo el país</span>
          </div>
          <div class="detail-service-grid" aria-label="Ayuda para decidir la compra">
            <article>
              <span>Calce</span>
              <strong>Compará antes de comprar</strong>
              <p>Usá la guía de talles o escribí por WhatsApp con tu talle habitual.</p>
            </article>
            <article>
              <span>Cuidado</span>
              <strong>Materiales protagonistas</strong>
              <p>Las texturas se lucen mejor con uso y guardado cuidadoso.</p>
            </article>
          </div>
        </article>
      </section>
      ${
        related.length
          ? `<section class="shop-section"><div class="section-heading"><div><p class="eyebrow">También puede funcionar</p><h2>Productos relacionados</h2></div></div><div class="product-grid">${productCards(related)}</div></section>`
          : ""
      }
    </main>`,
  });
}

function contactPage() {
  return pageShell({
    title: "Contacto | Crucru",
    description: "Canales de contacto y cultura de trabajo de Crucru.",
    body: `
    <main>
      <section class="brand-story">
        <div class="brand-story-copy">
          <p class="eyebrow">Cultura Crucru</p>
          <h1>Texturas con oficio, compra simple y trato directo.</h1>
          <p>Crucru trabaja desde una mirada cercana: prendas y calzado con presencia, materiales táctiles y una forma de vender que no necesita complicarse para sentirse cuidada.</p>
          <p>La tienda acompaña ese espíritu: menos ruido visual, más foco en cada pieza y canales claros para resolver dudas antes de comprar.</p>
        </div>
        <div class="brand-values">
          <article class="brand-value-feature">
            <span>01</span>
            <strong>Prendas con presencia</strong>
            <p>La selección se arma alrededor de texturas, calces cómodos y piezas que levantan un look sin perder uso cotidiano.</p>
          </article>
          <article>
            <span>02</span>
            <strong>Atención cercana</strong>
            <p>Las consultas de talle, stock o color se resuelven por WhatsApp e Instagram, con una conversación simple y directa.</p>
          </article>
          <article>
            <span>03</span>
            <strong>Qué enviar</strong>
            <p>Producto, talle deseado, color y zona de envío. Con eso se puede responder más rápido y evitar idas y vueltas.</p>
          </article>
          <article>
            <span>04</span>
            <strong>Compra ordenada</strong>
            <p>La operación se mantiene en Tiendanube: medios de pago, checkout, envíos y seguimiento quedan centralizados.</p>
          </article>
        </div>
      </section>

      <section class="contact-section">
        <div class="contact-copy">
          <p class="eyebrow">Contacto</p>
          <h2>Consultas, talles y disponibilidad.</h2>
          <p>Un espacio pensado para acompañar la decisión de compra: resolver dudas de talle, confirmar disponibilidad y sostener el trato directo que la marca ya tiene en redes.</p>
          <div class="contact-note">
            <strong>Compatible con Tiendanube</strong>
            <span>Este bloque puede trasladarse como contenido de página y mejorarse con CSS personalizado sobre el formulario nativo.</span>
          </div>
        </div>
        <div class="contact-grid">
          <div class="contact-channels" aria-label="Canales de contacto">
            <a class="contact-card is-primary" href="https://wa.me/5491155787296" target="_blank" rel="noreferrer">
              <span>WhatsApp</span>
              <strong>+54 9 11 5578 7296</strong>
              <small>Consultas de talle, stock y seguimiento.</small>
            </a>
            <a class="contact-card" href="https://www.instagram.com/crucruargentina" target="_blank" rel="noreferrer">
              <span>Instagram</span>
              <strong>@crucruargentina</strong>
              <small>Drops, looks, novedades y mensajes rápidos.</small>
            </a>
          </div>
          <div class="contact-form-card">
            <div class="form-card-heading">
              <span>Formulario</span>
              <strong>Mensaje directo desde la tienda</strong>
              <p>Dejá tu consulta y sumá el producto, talle o color que querés revisar. La respuesta puede continuar por mail, WhatsApp o Instagram.</p>
            </div>
            <form class="mock-form">
              <div class="form-row">
                <label>Nombre<input type="text" placeholder="Tu nombre" /></label>
                <label>Email<input type="email" placeholder="tuemail@email.com" /></label>
              </div>
              <label>Mensaje<textarea rows="5" placeholder="Ej.: Quiero saber si la Bota Salvaje está disponible en talle 38." ></textarea></label>
              <div class="form-footer">
                <small>Tiempo estimado de respuesta: dentro del día hábil.</small>
                <button type="button">Enviar consulta</button>
              </div>
            </form>
          </div>
          <div class="contact-support">
            <div class="support-heading">
              <span>Atención</span>
              <strong>Información útil para responder mejor.</strong>
              <p>Este contenido ayuda a que la página no dependa únicamente de un formulario: ordena expectativas, reduce dudas repetidas y mantiene el tono cercano de la marca.</p>
            </div>
            <div class="support-grid">
              <article>
                <span>01</span>
                <strong>Talle y calce</strong>
                <p>Podés escribir con tu talle habitual, medidas aproximadas o el producto que querés comparar.</p>
              </article>
              <article>
                <span>02</span>
                <strong>Stock y color</strong>
                <p>Si una variante no aparece disponible, consultá por reposición o alternativas similares del catálogo.</p>
              </article>
              <article>
                <span>03</span>
                <strong>Envíos</strong>
                <p>Para estimar tiempos, indicá localidad y provincia. La compra final sigue por checkout de Tiendanube.</p>
              </article>
              <article>
                <span>04</span>
                <strong>Cambios y cuidado</strong>
                <p>Conviene conservar el número de orden y consultar recomendaciones de uso según material.</p>
              </article>
            </div>
            <div class="response-window">
              <strong>Para agilizar la respuesta</strong>
              <span>Enviar producto, talle, color, zona de envío y canal preferido de contacto.</span>
            </div>
          </div>
        </div>
      </section>
    </main>`,
  });
}

function sizeGuideTable(section) {
  return `
    <article class="size-table-card">
      <div class="size-table-heading">
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.note)}</p>
      </div>
      <div class="table-wrap">
        <table class="size-table">
          <thead>
            <tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${section.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
    </article>`;
}

function sizeGuidePage() {
  return pageShell({
    title: "Guía de talles | Crucru",
    description: "Guía de talles de referencia scrapeada desde la tienda oficial de Crucru.",
    body: `
    <main>
      <section class="size-guide-hero">
        <div>
          <p class="eyebrow">Guía de talles</p>
          <h1>Medidas de referencia</h1>
          <p>Datos extraídos desde la página oficial de Tiendanube. La estructura queda lista para reemplazar o ajustar medidas cuando Crucru valide su tabla definitiva por producto.</p>
        </div>
        <aside class="measurement-note">
          <strong>Cómo medir</strong>
          <span>Usá una cinta flexible, medí sin ajustar de más y compará con una prenda que ya te quede cómoda.</span>
        </aside>
      </section>

      <section class="size-tables">
        ${sizeGuide.sections.map(sizeGuideTable).join("")}
      </section>

      <section class="measurement-help">
        <div>
          <p class="eyebrow">Para Tiendanube</p>
          <h2>Una guía clara reduce consultas y mejora la compra.</h2>
        </div>
        <p>En la tienda real, estas tablas pueden vivir en la página nativa de guía de talles y mejorarse con CSS personalizado: contenedores, tablas responsive, jerarquía tipográfica y llamados a WhatsApp para dudas.</p>
      </section>
    </main>`,
  });
}

function proposalPage() {
  const deliverables = [
    ["Diagnóstico y dirección", "Revisión de la tienda actual, detección de puntos de fricción y definición de una línea visual clara para vender mejor."],
    ["Implementación en Tiendanube", "Aplicación de CSS personalizado y bloques de contenido compatibles con la plataforma, sin modificar checkout ni operación interna."],
    ["Home y catálogo", "Mejoras sobre portada, accesos por categoría, productos destacados, mensajes comerciales, botones, etiquetas y lectura mobile."],
    ["Fichas de producto", "Mejor jerarquía de precio, cuotas, variantes, consulta de talle, cuidado/material, breadcrumbs y señales de confianza."],
    ["Contacto y guía de talles", "Secciones más claras para WhatsApp, Instagram, formulario, dudas frecuentes y tablas de medidas."],
    ["Dominio propio", "Servicio de acompañamiento para comprar y conectar el dominio de la marca a Tiendanube. El costo del dominio queda a cargo del cliente."],
    ["Activación Mundial", "Pop-up o bloque promocional con mecánica de sorteo, llamado a productos y textos listos para comunicar en tienda y redes."],
    ["Entrega documentada", "Archivo de CSS, guía de implementación y recomendaciones para que la marca pueda mantener la tienda sin complejidad técnica."],
  ];

  const optionalServices = [
    ["Mantenimiento mensual", "Ajustes menores, revisión mobile, actualización de banners y soporte visual continuo."],
    ["Carga o mejora de productos", "Orden de títulos, textos, fotos, categorías, variantes y mensajes de compra."],
    ["Email marketing / newsletter", "Diseño de bloque de suscripción, estructura de campaña y textos para lanzamientos."],
  ];

  return pageShell({
    title: "Propuesta comercial | Crucru",
    description: "Propuesta de mejora estética y comercial para tienda Crucru sobre Tiendanube.",
    body: `
    <main>
      <section class="proposal-hero">
        <div>
          <p class="eyebrow">Propuesta para Crucru</p>
          <h1>Mejorar la tienda para vender con más claridad.</h1>
          <p>El objetivo es elevar la presentación de la marca, ordenar la experiencia de compra y mantener Tiendanube como plataforma de administración, pagos, envíos y pedidos.</p>
        </div>
        <aside class="proposal-price">
          <span>Valor del proyecto</span>
          <strong>USD 1.000</strong>
          <p>Incluye implementación visual, estructura de contenidos, campaña especial, guía de trabajo y acompañamiento para dominio propio.</p>
        </aside>
      </section>

      <section class="proposal-summary">
        <article>
          <span>Problema actual</span>
          <p>La tienda funciona, pero la presentación visual no comunica el valor de los productos ni acompaña lo suficiente la decisión de compra.</p>
        </article>
        <article>
          <span>Solución propuesta</span>
          <p>Mejorar la percepción de marca y el recorrido comercial con recursos compatibles con Tiendanube: CSS, páginas, bloques HTML y ajustes del tema.</p>
        </article>
        <article>
          <span>Resultado esperado</span>
          <p>Una tienda más profesional, más clara para comprar y más fácil de presentar en redes, sin sumar complejidad operativa.</p>
        </article>
      </section>

      <section class="proposal-scope">
        <div class="section-heading">
          <div><p class="eyebrow">Alcance incluido</p><h2>Qué recibe el cliente por USD 1.000</h2></div>
          <a class="text-link" href="/">Ver mockup</a>
        </div>
        <div class="proposal-grid">
          ${deliverables
            .map(
              ([title, copy], index) => `
            <article>
              <span>${String(index + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(title)}</strong>
              <p>${escapeHtml(copy)}</p>
            </article>`,
            )
            .join("")}
        </div>
      </section>

      <section class="worldcup-activation" id="activacion-mundial">
        <div class="activation-card">
          <span>Activación Mundial</span>
          <strong>Pop-up + sorteo</strong>
          <p>Campaña simple para generar urgencia durante una fecha mundialista: una pieza promocional en tienda, una mecánica clara y mensajes listos para redes.</p>
        </div>
        <div class="activation-steps">
          <article><span>01</span><strong>Cartel promocional</strong><p>Pop-up o bloque destacado con llamado directo a comprar productos seleccionados.</p></article>
          <article><span>02</span><strong>Mecánica del sorteo</strong><p>Participan compras realizadas durante fechas definidas o usuarios que cumplan una acción en redes.</p></article>
          <article><span>03</span><strong>Comunicación lista</strong><p>Textos para tienda, historia de Instagram y mensaje de WhatsApp para consultas.</p></article>
        </div>
      </section>

      <section class="optional-services">
        <div class="section-heading">
          <div><p class="eyebrow">Servicios opcionales</p><h2>Extras que pueden sumarse después</h2></div>
        </div>
        <div class="optional-grid">
          ${optionalServices
            .map(
              ([title, copy]) => `
            <article>
              <strong>${escapeHtml(title)}</strong>
              <p>${escapeHtml(copy)}</p>
            </article>`,
            )
            .join("")}
        </div>
      </section>

      <section class="proposal-timeline">
        <div>
          <p class="eyebrow">Modalidad</p>
          <h2>Forma de trabajo propuesta.</h2>
        </div>
        <div class="timeline-list">
          <article><span>Etapa 1</span><strong>Definición</strong><p>Se revisan variantes visuales, prioridades comerciales y contenido necesario.</p></article>
          <article><span>Etapa 2</span><strong>Implementación</strong><p>Se aplica CSS personalizado y se cargan bloques compatibles con Tiendanube.</p></article>
          <article><span>Etapa 3</span><strong>Lanzamiento</strong><p>Revisión mobile, conexión de dominio, activación promocional y entrega de guía.</p></article>
        </div>
      </section>
    </main>`,
  });
}

function simplePage({ title, heading, copy }) {
  return pageShell({
    title: `${title} | Crucru`,
    description: copy,
    body: `
    <main>
      <section class="catalog-hero">
        <p class="eyebrow">${escapeHtml(title)}</p>
        <h1>${escapeHtml(heading)}</h1>
        <p>${escapeHtml(copy)}</p>
      </section>
    </main>`,
  });
}

await rm(path.join(ROOT, "productos"), { recursive: true, force: true });
await rm(path.join(ROOT, "contacto"), { recursive: true, force: true });
await rm(path.join(ROOT, "guia-de-talles"), { recursive: true, force: true });
await rm(path.join(ROOT, "propuesta"), { recursive: true, force: true });

await writeFile(path.join(ROOT, "index.html"), homePage());
await mkdir(path.join(ROOT, "productos"), { recursive: true });
await writeFile(path.join(ROOT, "productos", "index.html"), productsPage());

for (const product of products) {
  const dir = path.join(ROOT, "productos", product.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), productPage(product));
}

await mkdir(path.join(ROOT, "contacto"), { recursive: true });
await writeFile(path.join(ROOT, "contacto", "index.html"), contactPage());

await mkdir(path.join(ROOT, "guia-de-talles"), { recursive: true });
await writeFile(path.join(ROOT, "guia-de-talles", "index.html"), sizeGuidePage());

await mkdir(path.join(ROOT, "propuesta"), { recursive: true });
await writeFile(path.join(ROOT, "propuesta", "index.html"), proposalPage());

await writeFile(
  path.join(ROOT, "catalog.js"),
  `document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("is-active", item === button));
    document.querySelectorAll(".product-card").forEach((card) => {
      card.classList.toggle("is-hidden", filter !== "all" && card.dataset.category !== filter);
    });
  });
});
`,
);

console.log(`Sitio generado: ${products.length} productos y ${products.length + 5} rutas.`);
