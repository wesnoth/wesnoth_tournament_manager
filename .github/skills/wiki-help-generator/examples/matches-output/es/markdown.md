# Partidas

La página **Partidas** muestra todos los duelos clasificados jugados en el Gestor de Torneos de Wesnoth.

## ¿Qué es esta página?

La página Partidas es el centro central para ver, confirmar y gestionar tus duelos clasificados. Cada juego que juegas en el torneo se registra aquí.

Antes de ver tus partidas, asegúrate de:

- Que estés utilizando el complemento **Clasificado**
- Que **Duelos Clasificados** esté habilitado en tu perfil de jugador
- Que hayas jugado al menos un duelo clasificado

Para obtener más información sobre cómo configurar juegos clasificados, ve [Introducción](/help/getting-started).

## ¿Qué puedes hacer?

- **Ver partidas** - Consulta todos tus duelos clasificados en una lista
- **Confirmar partidas preliminares** - Confirma el resultado si el sistema no pudo determinarlo automáticamente
- **Informar partida** - Añade comentarios y califica a tu oponente después de ganar
- **Reportar partida** - Confirma el resultado, añade comentarios y califica al oponente después de perder
- **Disputar partida** - Solicita una revisión del resultado si crees que es incorrecto
- **Ver detalles** - Haz clic en una partida para ver toda la información del juego

## ¿Qué ocurre al realizar cada acción?

### Ver Partidas

Cuando abres la página Partidas, ves todas tus partidas en un formato de tabla:

![Vista de lista de partidas](/api/public/wiki/images/1781817655396_hgn6m6o.png)

*Las partidas reportadas automáticamente se muestran con fondo blanco*

Las partidas que se confirmaron automáticamente aparecen con fondo blanco. Las partidas que necesitan tu confirmación aparecen con fondo amarillo.

### Confirmar Partida Preliminar

Cuando tienes una partida amarilla (preliminar) que necesita confirmación, haz clic en **"Gané"** o **"Perdí"**:

![Botón de confirmación de partida preliminar](/api/public/wiki/images/1781818945833_8ug06.png)

*Las partidas preliminares se muestran con fondo amarillo y requieren confirmación*

Aparecerá un formulario de confirmación:

![Formulario de confirmación de partida preliminar](/api/public/wiki/images/1781819051699_alfi6s.png)

Puedes:

- Confirmar el resultado haciendo clic en **"Confirmar"**
- Añadir un comentario sobre el juego
- Calificar a tu oponente de 1 a 5 estrellas
- Cancelar la confirmación si es necesario

Una vez confirmada, la partida se convierte en una partida clasificada normal y tu clasificación ELO se actualiza.

### Informar Partida (Acción del Ganador)

Después de ganar una partida, puedes hacer clic en **"Informar Partida"** para añadir comentarios y calificar a tu oponente:

![Botón Informar Partida](/api/public/wiki/images/1781817919922_hpq8cs.png)

*La acción Informar Partida aparece en las partidas que ganaste*

Esto abre un formulario donde puedes:

- Añadir comentarios sobre la partida
- Calificar a tu oponente
- Enviar tu retroalimentación

### Reportar Partida (Acción del Perdedor)

Después de perder una partida, puedes hacer clic en **"Reportar Partida"** para confirmar el resultado y proporcionar comentarios:

![Botón Reportar Partida](/api/public/wiki/images/1781817981599_cpr72v.png)

*La acción Reportar Partida aparece en las partidas que perdiste*

Puedes:

- Confirmar el resultado de la partida
- Añadir comentarios
- Calificar a tu oponente
- Solicitar una disputa si crees que el resultado es incorrecto

### Disputar Partida

Si crees que un resultado es incorrecto, puedes solicitar una disputa:

![Formulario de solicitud de disputa](/api/public/wiki/images/1781819051699_alfi6s.png)

Cuando abres una disputa:

- Proporciona una breve explicación de por qué disputas el resultado
- Un moderador o administrador revisará tu reclamo
- Aceptarán o rechazarán la disputa
- Si se acepta, la partida se cancela y los cambios de ELO se revierten

### Estados de Partidas

Las partidas pueden tener diferentes estados según su condición:

**Reportada** - La partida acaba de crearse y solo un jugador la ha confirmado.

![Estado de partida reportada](/api/public/wiki/images/1781818545716_b3x044.png)

**Confirmada** - Ambos jugadores han confirmado el resultado.

**Cancelada** - La partida fue cancelada (generalmente debido a una disputa aceptada). Las partidas canceladas se muestran con fondo rojo.

![Pantalla de partida cancelada](/api/public/wiki/images/1781818721602_2x0psi.png)

*Las partidas canceladas aparecen con fondo rojo y no muestran cambio de ELO*

El archivo de repetición sigue disponible para descargarse incluso después de la cancelación.

## Páginas Relacionadas

- [Clasificaciones](/help/rankings) - Ve tu rango y compáralo con otros jugadores
- [Estadísticas](/help/statistics) - Consulta estadísticas detalladas y tendencias
- [Introducción](/help/getting-started) - Aprende cómo configurar duelos clasificados
