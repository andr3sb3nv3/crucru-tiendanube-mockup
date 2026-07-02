# Crucru mockup

Mockup local para presentar una mejora estética de la tienda Crucru manteniendo la lógica de Tiendanube.

## Qué incluye

- Home responsive con imagen editorial real de la tienda.
- Catálogo con productos, precios, variantes y fotos scrapeadas de la tienda actual.
- Rutas locales equivalentes a Tiendanube: `/productos/` y `/productos/<slug>/`.
- Filtros por categoría en catálogo.
- Estética con glassmorphism sutil, sombras neumórficas suaves y composición más editorial.
- `tiendanube-custom.css` como base de CSS trasladable al editor personalizado de Tiendanube.

## Cómo verlo

```bash
python3 -m http.server 5173
```

Luego abrir `http://localhost:5173`.

## Actualizar catálogo

```bash
node scripts/scrape-site.mjs
node scripts/scrape-size-guide.mjs
node scripts/build-site.mjs
```

El scraper de productos usa `sitemap.xml` como fuente de verdad, entra a cada ficha, extrae variantes desde `LS.variants`, descarga imágenes locales y genera `data/products.json`.

La guía de talles se scrapea desde `/guia-de-talles/` y genera `data/size-guide.json` con las tablas oficiales de Remeras, Pantalones y Calzado.

## Rutas generadas

- `/`
- `/productos/`
- `/productos/alpargata-yute-feline-6lyx9/`
- `/productos/alpargata-yute-icon-15pom/`
- `/productos/alpargata-yute-safari-n4daw/`
- `/productos/alpargata-yute-tiger-1j36r/`
- `/productos/alpargata-yute-uumqx/`
- `/productos/bota-salvaje/`
- `/productos/saco-nido/`
- `/productos/sacon-nube/`
- `/productos/slippers-salvaje-3jl4n/`
- `/productos/sweater-x7zuc/`
- `/contacto/`
- `/guia-de-talles/`

## Fuentes usadas

- Tienda actual: https://crucru3.mitiendanube.com/
- Instagram de marca: https://www.instagram.com/crucruargentina

## Notas para la reunión

- La URL actual es un subdominio de Tiendanube. Para producción conviene comprar y conectar un dominio propio.
- El mockup no reemplaza el checkout de Tiendanube. La idea es mejorar percepción visual, jerarquía y navegación sin cambiar la operación diaria del cliente.
- Con CSS personalizado se puede mejorar tipografía, paleta, botones, grilla, labels, newsletter y header. Cambios estructurales profundos dependen del tema contratado y de las opciones del editor.
- Ver también `docs/tiendanube-implementation.md` para explicar alcance real de implementación.
