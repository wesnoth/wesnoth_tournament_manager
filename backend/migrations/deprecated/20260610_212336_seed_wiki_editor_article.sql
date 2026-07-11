-- Seed wiki articles: Editor guide (English + Spanish)
-- Now works with UNIQUE(slug, language) constraint

INSERT INTO wiki_articles (slug, title, content_markdown, language, is_published)
VALUES 
  ('wiki-editor', 'Using the Wiki Editor', '# Using the Wiki Editor

Welcome to the Wesnoth Tournament Manager Wiki! This guide explains how to write articles using Markdown syntax.

## Basic Syntax

### Headers
Use `#` to create headers. More `#` symbols = smaller headers:

```
# Main Title (H1)
## Subtitle (H2)
### Sub-subtitle (H3)
#### And so on... (H4)
```

### Text Formatting

**Bold text**: Wrap with `**text**` or `__text__`
*Italic text*: Wrap with `*text*` or `_text_`
`Code/monospace`: Wrap with backticks

Example:
- **Bold**: This is **important**
- *Italic*: This is *emphasized*
- Code: Use the `GET /api/wiki` endpoint

### Line Breaks

To create a new paragraph, leave a **blank line**:

This is paragraph one.

This is paragraph two.

For a single line break without a new paragraph, end a line with two spaces:
Line one  
Line two (same paragraph)

### Lists

**Unordered lists** (use `-`, `*`, or `+`):
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

**Ordered lists** (use `1.`, `2.`, etc):
1. First step
2. Second step
   1. Sub-step
   2. Another sub-step
3. Third step

### Quotes

Use `>` to create blockquotes:

> This is a quote
> It can span multiple lines
> 
> And have multiple paragraphs

### Code Blocks

Use triple backticks with optional language:

```
Plain code block
No syntax highlighting
```

```json
{
  "slug": "wiki-editor",
  "language": "en",
  "is_published": true
}
```

### Links

**Text link**: `[Link text](https://example.com)`
Example: [Visit Wesnoth](https://www.wesnoth.org)

**Link to wiki article**: `[Article name](/help/getting-started)`
Example: [Getting Started](/help/getting-started)

### Images

To embed an image:
`![Alt text](https://example.com/image.png)`

Example: ![Wesnoth Logo](https://www.wesnoth.org/logo.png)

*Note: Use images from the wiki image library for consistency.*

## Supported Elements

✅ **These work:**
- Headers (H1-H6)
- **Bold** and *italic* text
- `Inline code` and code blocks
- Unordered and ordered lists with nesting
- Blockquotes
- Links (internal and external)
- Images (from uploaded wiki images)
- Horizontal rules: `---` or `***`
- Tables: Use markdown table syntax

## NOT Supported

❌ **These are filtered out (security):**
- **Colored text** - HTML color tags are stripped by sanitizer
- **Custom HTML** - No `<div>`, `<span>`, `<style>` tags
- **JavaScript** - Event handlers like `onclick` are removed
- **External style sheets** - No `<link rel="stylesheet">` tags

We use a security sanitizer (DOMPurify) to prevent XSS attacks, so advanced HTML/CSS is not allowed.

## Best Practices

1. **Start with a main heading** (`# Title`) at the top
2. **Use descriptive slugs** - lowercase, hyphens: `getting-started`, `elo-rating-explained`
3. **Keep sections short** - Break content into logical chunks with headers
4. **Use lists** for steps and options - More readable than paragraphs
5. **Add examples** - Real-world examples help users understand
6. **Link to related articles** - Use `[link text](/help/slug-name)` to cross-reference
7. **Language consistency** - If you create an article in English, also create a Spanish version with the same slug but `language: "es"`
8. **Test your markdown** - Use the live preview before publishing

Happy writing! 🎉', 'en', 1),
  ('wiki-editor', 'Usando el Editor del Wiki', '# Usando el Editor del Wiki

¡Bienvenido al Wiki del Administrador de Torneos de Wesnoth! Esta guía explica cómo escribir artículos usando sintaxis Markdown.

## Sintaxis Básica

### Encabezados
Usa `#` para crear encabezados. Más símbolos `#` = encabezados más pequeños:

```
# Título Principal (H1)
## Subtítulo (H2)
### Sub-subtítulo (H3)
#### Y así sucesivamente... (H4)
```

### Formato de Texto

**Texto en negrita**: Envuelve con `**texto**` o `__texto__`
*Texto en cursiva*: Envuelve con `*texto*` o `_texto_`
`Código/monospace`: Envuelve con backticks

Ejemplo:
- **Negrita**: Esto es **importante**
- *Cursiva*: Esto es *enfatizado*
- Código: Usa el endpoint `GET /api/wiki`

### Saltos de Línea

Para crear un nuevo párrafo, deja una **línea en blanco**:

Este es el párrafo uno.

Este es el párrafo dos.

Para un salto de línea simple sin nuevo párrafo, termina una línea con dos espacios:
Línea uno  
Línea dos (mismo párrafo)

### Listas

**Listas sin orden** (usa `-`, `*`, o `+`):
- Primer elemento
- Segundo elemento
  - Elemento anidado
  - Otro elemento anidado
- Tercer elemento

**Listas ordenadas** (usa `1.`, `2.`, etc):
1. Primer paso
2. Segundo paso
   1. Sub-paso
   2. Otro sub-paso
3. Tercer paso

### Citas

Usa `>` para crear citas en bloque:

> Esta es una cita
> Puede abarcar múltiples líneas
> 
> Y tener múltiples párrafos

### Bloques de Código

Usa triple backticks con lenguaje opcional:

```
Bloque de código simple
Sin resaltado de sintaxis
```

```json
{
  "slug": "wiki-editor",
  "language": "es",
  "is_published": true
}
```

### Enlaces

**Enlace de texto**: `[Texto del enlace](https://ejemplo.com)`
Ejemplo: [Visita Wesnoth](https://www.wesnoth.org)

**Enlace a artículo del wiki**: `[Nombre del artículo](/help/getting-started)`
Ejemplo: [Empezar](/help/getting-started)

### Imágenes

Para incrustar una imagen:
`![Texto alternativo](https://ejemplo.com/imagen.png)`

Ejemplo: ![Logo de Wesnoth](https://www.wesnoth.org/logo.png)

*Nota: Usa imágenes de la biblioteca de imágenes del wiki para consistencia.*

## Elementos Soportados

✅ **Estos funcionan:**
- Encabezados (H1-H6)
- Texto en **negrita** e *cursiva*
- `Código en línea` y bloques de código
- Listas ordenadas y sin orden con anidamiento
- Citas en bloque
- Enlaces (internos y externos)
- Imágenes (de imágenes cargadas en el wiki)
- Líneas horizontales: `---` o `***`
- Tablas: Usa sintaxis de tablas markdown

## NO Soportados

❌ **Estos se filtran (seguridad):**
- **Texto de color** - Las etiquetas de color HTML se eliminan por el sanitizador
- **HTML personalizado** - No se permiten etiquetas `<div>`, `<span>`, `<style>`
- **JavaScript** - Se eliminan manejadores de eventos como `onclick`
- **Hojas de estilo externas** - No se permiten etiquetas `<link rel="stylesheet">`

Usamos un sanitizador de seguridad (DOMPurify) para prevenir ataques XSS, por lo que HTML/CSS avanzado no está permitido.

## Mejores Prácticas

1. **Comienza con un encabezado principal** (`# Título`) en la parte superior
2. **Usa slugs descriptivos** - Minúsculas, guiones: `getting-started`, `elo-rating-explained`
3. **Mantén secciones cortas** - Divide el contenido en partes lógicas con encabezados
4. **Usa listas** para pasos y opciones - Más legible que párrafos
5. **Añade ejemplos** - Los ejemplos del mundo real ayudan a los usuarios a entender
6. **Enlaza a artículos relacionados** - Usa `[texto del enlace](/help/slug-name)` para referencias cruzadas
7. **Consistencia de idioma** - Si creas un artículo en inglés, también crea una versión en español con el mismo slug pero `language: "es"`
8. **Prueba tu markdown** - Usa la vista previa en vivo antes de publicar

¡Feliz escritura! 🎉', 'es', 1);
