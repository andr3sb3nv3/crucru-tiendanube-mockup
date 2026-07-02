# Implementación en Tiendanube

Este mockup está pensado para continuar sobre Tiendanube, manteniendo la operación actual de productos, stock, pagos, envíos y pedidos.

## Prioridad 1: CSS directo

Pegar `tiendanube-custom.css` en **Diseño > Personalizar diseño > CSS personalizado**.

- Paleta, fondo general, header translúcido, footer, newsletter, botones y labels.
- Cartel superior de cuotas y menú principal fijos durante el scroll.
- Catálogo nativo: tarjetas de producto, imágenes, nombres, precios, badges y estados hover.
- Formulario nativo de contacto: campos, foco, textarea y botón principal.
- Tablas nativas o pegadas en páginas de contenido, especialmente guía de talles.
- Breadcrumbs o migas de navegación nativas del tema, si están disponibles.
- Ajustes responsive para que categorías, contacto, CTA y tablas respiren en mobile.

## Prioridad 2: bloques HTML de contenido

Estos bloques no dependen del checkout ni de la administración de productos. Se pueden pegar en páginas o secciones de contenido del tema y quedan estilados por el CSS:

- `hero-panel`: resumen de marca dentro de hero o portada.
- `editorial-ribbon`: frase editorial o manifiesto visual.
- `review-strip`: reseñas o microtestimonios ubicados al inicio de la home para reforzar confianza antes del catálogo.
- `category-grid` y `category-tile`: accesos visuales a categorías.
- `month-selection`: curaduría destacada con imagen, copy y links a productos.
- `product-card`: tarjetas curadas para home o páginas editoriales, sin reemplazar el catálogo nativo.
- `product-trust`: mensajes de confianza en páginas de producto o contenido.
- `fit-preview`: bloque de ayuda para talle, material y consultas antes de comprar.
- `detail-service-grid`: microbloques de apoyo dentro de la ficha de producto.
- `brand-film`: video institucional o de proceso para contar cultura de trabajo, materiales y backstage de marca.
- `store-cta`: cierre de compra con links a catálogo, contacto o guía de talles.
- `floating-contact`: acceso fijo a WhatsApp, útil si el tema permite pegar un link global o editar plantilla.
- `floating-dock`: barra de presentación con WhatsApp, variantes visuales y acceso a propuesta.
- `proposal-hero`, `proposal-summary`, `proposal-grid`, `optional-grid`, `worldcup-activation` y `proposal-timeline`: página comercial para explicar problema, alcance, valor, opcionales y etapas.
- Contacto: `contact-section`, `contact-card`, `contact-form-card`, `mock-form` y `contact-support`.
- Tablas: `size-tables`, `size-table-card`, `table-wrap` y `size-table`.

## Propuesta comercial sugerida

Valor de referencia: **USD 1.000**.

Incluye:

- Rediseño visual sobre Tiendanube con CSS personalizado.
- Bloques editoriales para home, catálogo, fichas, contacto y guía de talles.
- Activación Mundial con pop-up promocional, mecánica de sorteo y copies de campaña.
- Demo de ruleta mundialista con estética Argentina/Crucru. En producción conviene implementarla con una app de pop-ups, bloque HTML controlado o desarrollo sobre plantilla según permisos del tema.
- Compra y conexión de dominio propio para la marca.
- Revisión mobile y documentación de implementación.

Servicios opcionales para cotizar aparte:

- Mantenimiento mensual de tienda.
- Carga o mejora de productos.
- Email marketing/newsletter.

## Prioridad 3: límites del tema

Depende del tema, de edición avanzada o de apps adicionales:

- Cambiar profundamente el orden interno del home.
- Crear sliders, galerías o módulos no previstos por el tema.
- Modificar comportamiento del carrito, checkout o cálculo de envío.
- Agregar lógica compleja de filtros o selección de variantes fuera de lo nativo.
- Automatizar videos dinámicos por producto sin tocar plantilla o apps adicionales.

## Recomendación

Mantener Tiendanube como backoffice y checkout. Primero aplicar CSS, después sumar bloques HTML medidos en home, contacto y guía de talles. Dejar cambios estructurales del tema para una segunda etapa si el cliente valida la dirección visual.
