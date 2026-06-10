-- Seed wiki editor guide articles (English + Spanish)

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

**Embed image**: `![Alt text](/uploads/wiki/filename.jpg)`

To add an image:
1. Click the **📷 Insert Image** button in the editor
2. Select a PNG, JPG, GIF, WebP, or SVG file (max 5MB)
3. The image URL will be inserted at your cursor position

Example: ![Tournament bracket](/uploads/wiki/bracket-example.jpg)

### Horizontal Lines

Create a separator with `---`, `***`, or `___`:

Text above
---
Text below

## Important Notes

### Supported Elements
- ✅ Headers, bold, italic, code
- ✅ Lists (ordered, unordered, nested)
- ✅ Blockquotes
- ✅ Code blocks with syntax highlighting
- ✅ Links (internal and external)
- ✅ Images from wiki uploads
- ✅ Horizontal rules
- ✅ Tables (basic markdown tables)

### Not Supported
- ❌ Text colors (use bold/italic for emphasis instead)
- ❌ HTML tags (automatically stripped for security)
- ❌ Custom fonts or styling
- ❌ Videos or embeds (security restriction)

### Best Practices

1. **Use clear headers** to structure your article
2. **Keep paragraphs short** for readability
3. **Use lists** for step-by-step instructions
4. **Link to related articles** for context
5. **Add images** to illustrate complex concepts
6. **Use code blocks** for examples or commands
7. **Write in your language** - the system automatically handles translations
8. **Test with Preview** before saving

### Example Article Structure

```
# Main Topic

Brief introduction paragraph.

## Section One
Explanation with examples.

### Subsection
More details.

## Section Two
Another topic.

- Point one
- Point two
- Point three

See also: [Related Article](/help/related-article)
```

## Publishing vs Draft

- **Draft**: `is_published` unchecked - only visible to admins/mods during editing
- **Published**: `is_published` checked - visible to all users

Save as draft while working, then publish when ready!

## Need Help?

For questions about the wiki system itself, contact the administrators.', 'en', 1),

  ('wiki-editor', 'Usar el Editor del Wiki', '# Usar el Editor del Wiki

¡Bienvenido al Wiki del Gestor de Torneos de Wesnoth! Esta guía explica cómo escribir artículos usando sintaxis Markdown.

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

**Texto en negrita**: Rodea con `**texto**` o `__texto__`
*Texto en cursiva*: Rodea con `*texto*` o `_texto_`
`Código/monoespaciado`: Rodea con comillas invertidas

Ejemplo:
- **Negrita**: Esto es **importante**
- *Cursiva*: Esto está *enfatizado*
- Código: Usa el endpoint `GET /api/wiki`

### Saltos de Línea

Para crear un párrafo nuevo, deja una **línea en blanco**:

Este es el primer párrafo.

Este es el segundo párrafo.

Para un salto de línea único sin párrafo nuevo, termina la línea con dos espacios:
Primera línea  
Segunda línea (mismo párrafo)

### Listas

**Listas desordenadas** (usa `-`, `*`, o `+`):
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

Usa `>` para crear citas:

> Esta es una cita
> Puede ocupar varias líneas
> 
> Y tener varios párrafos

### Bloques de Código

Usa triple acento grave con lenguaje opcional:

```
Bloque de código simple
Sin resaltado de sintaxis
```

```json
{
  "slug": "editor-wiki",
  "language": "es",
  "is_published": true
}
```

### Enlaces

**Enlace de texto**: `[Texto del enlace](https://ejemplo.com)`
Ejemplo: [Visita Wesnoth](https://www.wesnoth.org)

**Enlace a artículo wiki**: `[Nombre del artículo](/help/getting-started)`
Ejemplo: [Cómo Empezar](/help/getting-started)

### Imágenes

**Insertar imagen**: `![Texto alternativo](/uploads/wiki/archivo.jpg)`

Para agregar una imagen:
1. Haz clic en el botón **📷 Insertar Imagen** del editor
2. Selecciona un archivo PNG, JPG, GIF, WebP o SVG (máx. 5MB)
3. La URL de la imagen se insertará en tu posición del cursor

Ejemplo: ![Bracket de torneo](/uploads/wiki/bracket-example.jpg)

### Líneas Horizontales

Crea un separador con `---`, `***`, o `___`:

Texto arriba
---
Texto abajo

## Notas Importantes

### Elementos Soportados
- ✅ Encabezados, negrita, cursiva, código
- ✅ Listas (ordenadas, desordenadas, anidadas)
- ✅ Citas en bloque
- ✅ Bloques de código con resaltado de sintaxis
- ✅ Enlaces (internos y externos)
- ✅ Imágenes desde cargas de wiki
- ✅ Líneas horizontales
- ✅ Tablas (tablas markdown básicas)

### No Soportado
- ❌ Colores de texto (usa negrita/cursiva para énfasis)
- ❌ Etiquetas HTML (se eliminan automáticamente por seguridad)
- ❌ Fuentes o estilos personalizados
- ❌ Vídeos o incrustaciones (restricción de seguridad)

### Mejores Prácticas

1. **Usa encabezados claros** para estructurar tu artículo
2. **Mantén párrafos cortos** para mejor legibilidad
3. **Usa listas** para instrucciones paso a paso
4. **Enlaza artículos relacionados** para dar contexto
5. **Agrega imágenes** para ilustrar conceptos complejos
6. **Usa bloques de código** para ejemplos o comandos
7. **Escribe en tu idioma** - el sistema maneja automáticamente las traducciones
8. **Prueba con Vista Previa** antes de guardar

### Ejemplo de Estructura de Artículo

```
# Tema Principal

Párrafo de introducción breve.

## Sección Uno
Explicación con ejemplos.

### Sub-sección
Más detalles.

## Sección Dos
Otro tema.

- Punto uno
- Punto dos
- Punto tres

Ver también: [Artículo Relacionado](/help/articulo-relacionado)
```

## Publicado vs Borrador

- **Borrador**: `Publicar` sin marcar - solo visible para admins/mods mientras editas
- **Publicado**: `Publicar` marcado - visible para todos los usuarios

¡Guarda como borrador mientras trabajas, luego publica cuando esté listo!

## ¿Necesitas Ayuda?

Para preguntas sobre el sistema wiki, contacta a los administradores.', 'es', 1);
