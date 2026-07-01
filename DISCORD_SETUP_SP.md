# Discord Integration & Environment Control Guide

## Configuración de variables en Railway

Para habilitar la integración y control de notificaciones de Discord, añade las siguientes variables de entorno a tu proyecto Railway:

### Variables requeridas

```
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_FORUM_CHANNEL_ID=your_forum_channel_id_here
DISCORD_P2P_CHALLENGE_CHANNEL_ID=your_p2p_challenges_channel_id_here
DISCORD_ENABLED=true
```

- **DISCORD_BOT_TOKEN:** Token de tu bot de Discord
- **DISCORD_FORUM_CHANNEL_ID:** ID del canal de foro donde se crearán los hilos de torneos
- **DISCORD_P2P_CHALLENGE_CHANNEL_ID:** ID del canal plano donde se publican los retos P2P (sin threads)
- **DISCORD_ENABLED:** `true` para habilitar notificaciones, cualquier otro valor (o no definido) las desactiva

## Cómo obtener los valores

### 1. DISCORD_BOT_TOKEN
1. Ve a [Discord Developer Portal](https://discord.com/developers/applications)
2. Crea una nueva aplicación y añade un bot
3. Copia el token del bot y pégalo como `DISCORD_BOT_TOKEN` en Railway

### 2. DISCORD_FORUM_CHANNEL_ID
1. Crea un canal de foro en tu servidor Discord (ej: "tournaments")
2. Haz clic derecho y selecciona "Copy Channel ID"
3. Pega ese valor como `DISCORD_FORUM_CHANNEL_ID` en Railway

### 3. DISCORD_P2P_CHALLENGE_CHANNEL_ID
1. Crea un canal de texto normal en tu servidor Discord (ej: "challenges")
2. Haz clic derecho y selecciona "Copy Channel ID"
3. Pega ese valor como `DISCORD_P2P_CHALLENGE_CHANNEL_ID` en Railway

### 4. Permisos del bot
1. En OAuth2 > URL Generator, selecciona el scope `bot` y los permisos:
   - Send Messages
   - Create Public Threads
   - Manage Threads
2. Autoriza el bot en tu servidor

## Control de notificaciones por entorno

La variable `DISCORD_ENABLED` permite activar o desactivar las notificaciones de Discord sin depender del entorno de despliegue:

- `DISCORD_ENABLED=true` → Discord **habilitado** ✅
- `DISCORD_ENABLED=false` o no definido → Discord **deshabilitado** ⏭️

**Recomendación:**
- En producción: `DISCORD_ENABLED=true`
- En test/desarrollo: `DISCORD_ENABLED=false` o no definida

## Comportamiento e implementación

- Si `DISCORD_ENABLED` es `true`, el sistema enviará notificaciones a Discord normalmente.
- Si está en `false` o no definida, los métodos de notificación retornan sin error y se loguea que Discord está deshabilitado.
- El sistema es tolerante a fallos: si la API de Discord falla o las variables no están configuradas, el resto de la aplicación sigue funcionando.
- El estado de Discord y los skips se loguean en consola para trazabilidad.

**Ejemplo de log al iniciar:**
```
🔔 Discord Service: ✅ ENABLED (DISCORD_ENABLED=true)
```
O si está deshabilitado:
```
🔔 Discord Service: ⏭️  DISABLED (DISCORD_ENABLED=not set)
```

**Ejemplo de log al intentar notificar con Discord deshabilitado:**
```
⏭️  Discord disabled (DISCORD_ENABLED=false). Skipping thread creation.
```

## Qué hace la integración

Una vez configurado:

✅ Crea un hilo de Discord automáticamente al crear un torneo  
✅ Publica actualizaciones de participantes, inicio, rondas y resultados  
✅ Permite comentarios en el hilo de Discord sin restricciones

## Pruebas y verificación

1. Crea un torneo en la aplicación
2. Verifica que aparece un hilo en el canal de foro de Discord
3. Si `DISCORD_ENABLED` está desactivado, revisa los logs para confirmar que las operaciones se omiten correctamente

## Resumen de código relevante

- El servicio de Discord en `backend/src/services/discordService.ts` usa:
  ```typescript
  const DISCORD_ENABLED = process.env.DISCORD_ENABLED === 'true';
  console.log(`🔔 Discord Service: ${DISCORD_ENABLED ? '✅ ENABLED' : '⏭️  DISABLED'} (DISCORD_ENABLED=${process.env.DISCORD_ENABLED || 'not set'})`);
  ```
- Todos los métodos de notificación están protegidos por este flag y loguean si se omite la operación.

## Beneficios

1. **Control independiente:** Puedes activar/desactivar Discord sin cambiar el entorno
2. **Tolerancia a fallos:** El sistema nunca falla por problemas de Discord
3. **Logs claros:** Siempre sabrás si Discord está activo y por qué
4. **Fácil de usar:** Solo cambia la variable en Railway

## Soporte

Para problemas con la API de Discord, consulta la [documentación oficial](https://discord.com/developers/docs/intro)
