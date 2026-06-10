-- Fix double-stringified JSON in wiki_articles
-- Data was stored as: {"en": "{\"title\": ...}", ...} (nested strings)
-- Should be: {"en": {"title": ...}, ...} (nested objects)
-- This migration unescape all stringified values back to proper JSON objects

UPDATE wiki_articles
SET translations = 
  CONCAT(
    '{"en":',
    IF(JSON_EXTRACT(translations, '$.en') LIKE '"%', 
       JSON_UNQUOTE(JSON_EXTRACT(translations, '$.en')),
       JSON_EXTRACT(translations, '$.en')
    ),
    ',"es":',
    IF(JSON_EXTRACT(translations, '$.es') LIKE '"%', 
       JSON_UNQUOTE(JSON_EXTRACT(translations, '$.es')),
       JSON_EXTRACT(translations, '$.es')
    ),
    ',"de":',
    IF(JSON_EXTRACT(translations, '$.de') LIKE '"%', 
       JSON_UNQUOTE(JSON_EXTRACT(translations, '$.de')),
       JSON_EXTRACT(translations, '$.de')
    ),
    ',"fr":',
    IF(JSON_EXTRACT(translations, '$.fr') LIKE '"%', 
       JSON_UNQUOTE(JSON_EXTRACT(translations, '$.fr')),
       JSON_EXTRACT(translations, '$.fr')
    ),
    ',"zh":',
    IF(JSON_EXTRACT(translations, '$.zh') LIKE '"%', 
       JSON_UNQUOTE(JSON_EXTRACT(translations, '$.zh')),
       JSON_EXTRACT(translations, '$.zh')
    ),
    '}'
  )
WHERE translations IS NOT NULL;
