# CLAUDE.md · Reto 02 · Registro de Contratos Vigentes

Agente conversacional en TypeScript (Bun o Node 20+) para el reto técnico 02 de Periferia IT Group. Lee un buzón simulado de correos, extrae datos de contratos, los clasifica (`nuevo`, `actualizacion`, `duplicado`, `rechazado`), registra en un maestro CSV, archiva los documentos y genera alertas de vencimiento.

**Fuente de verdad:** `PRD.md` (v2.0). Si este archivo contradice al PRD, gana el PRD y hay que avisar.

## Comandos

- `bun install`
- `bun run demo.ts`: procesa el buzón sin modelo. Debe ser determinista.
- `bun run dev`: levanta backend y front.
- `bun test`: pruebas de RN1 a RN7 y de los casos msg-001 a msg-006.

Si `package.json` define nombres distintos, usar los del `package.json` y actualizar esta sección.

## Estructura del repositorio

Ver PRD §6.5. Cada parte tiene una responsabilidad fija:

- `agent/prompt.md`: comportamiento del agente. Es el único system prompt; no lo embebas en código.
- `src/knowledge/registro-contratos.md`: conocimiento del proceso que el agente consulta.
- `src/tools/contratos.ts`: herramientas. Cada export se expone como `contratos_<export>`.
- `src/llm/adapter.ts`: interfaz `enviar(mensajes, herramientas)`. Una implementación por proveedor. Cambiar de proveedor no debe tocar el ciclo del agente.
- `src/server.ts`: API HTTP y ciclo del agente.
- `web/`: front de chat.
- `demo.ts`: llama a las herramientas directamente, sin modelo.
- `fixtures/`: **solo lectura. Nunca modificar.**
- `out/`: salida generada. `demo.ts` la limpia al inicio.

## Fixtures

- `fixtures/reto-02/maestro-contratos.csv`: maestro congelado al 2026-05-30. Se copia a `out/sharepoint/` en la primera ejecución (RN6). Todas las escrituras van a la copia.
- `fixtures/reto-02/comerciales.json`: catálogo `{ email, nombre, region }[]`.
- `fixtures/reto-02/buzon/<mensaje_id>/correo.json` con `{ id, de, para, asunto, fecha, cuerpo, adjuntos[] }`, más los adjuntos (`contrato.txt`, `otrosi.txt`, cotizaciones).

## Contrato de herramientas (PRD §6.2)

Cada herramienta es un objeto con tres miembros:

```ts
export const leer_buzon = {
  description: "Una frase precisa: es lo único que el modelo lee para decidir cuándo llamarla.",
  args: { /* esquemas zod con .describe() en cada campo */ },
  async execute(args, ctx: { directory: string; sessionId: string }): Promise<string> { /* ... */ },
}
```

- `execute` devuelve un **string JSON**: `{ ok: true, data }` o `{ ok: false, error }`.
- **Nunca lanza.** Cualquier excepción se captura y se convierte en `{ ok: false, error }` legible.
- El backend valida `args` con zod antes de ejecutar y devuelve el error al modelo si no cumple.
- Las rutas se resuelven desde `ctx.directory`. Nunca rutas absolutas.
- Las herramientas no ejecutan comandos de shell.
- Son la **única** fuente de valores que el agente puede afirmar. El modelo no puede inventar ni redondear un valor; solo puede proponerlo, y el humano confirma.

Herramientas P0: `contratos_leer_buzon`, `contratos_extraer`, `contratos_validar`, `contratos_registrar`, `contratos_alertas`. P1 opcional: `contratos_leer_pdf`.

## Reglas de negocio (PRD §7.3)

- **RN1 duplicado:** mismo `id_contrato` y mismos `valor`, `fecha_inicio`, `fecha_fin`. No se escribe nada; se reporta.
- **RN2 actualización:** mismo `id_contrato`, o mismo `nit_cliente` con similitud de `objeto` ≥ 0.9, y algún campo distinto, o el documento es un otrosí. Se actualiza la fila y se registra el cambio en `historial.jsonl`.
- **RN3 nuevo:** sin coincidencia. Se inserta.
- **RN4 rechazado:** sin adjunto de contrato, o texto sin partes ni objeto identificables. Se reporta con motivo.
- **RN5 confianza:** campos con confianza < 0.8 van a `requiere_revision`. `contratos_registrar` sin `confirmado: true` los rechaza.
- **RN6:** el fixture es de solo lectura.
- **RN7:** cada ejecución deja una línea en `out/log.jsonl` con `{ ts, herramienta, mensaje_id, ok, resumen }`.

## Constantes

| Constante | Valor |
|---|---|
| Confianza mínima por campo | 0.8 |
| Similitud mínima de objeto (RN2) | 0.9 |
| Ventana de vencimiento | 60 días |
| Corte del gap | 2026-05-30 |
| Tope de iteraciones herramienta → modelo por turno | 25 |
| Tope de tokens por sesión | configurable por variable de entorno |

La fecha de referencia `hoy` se pasa como argumento. Nunca usar `Date.now()` en la lógica de negocio, para que la demo sea reproducible.

## Normalización

- **NIT:** sin puntos ni dígito de verificación. `890.900.111-4` → `890900111`.
- **Email de comercial:** minúsculas y sin espacios antes de comparar con el catálogo.
- **Valor:** número sin separadores, en unidades de la moneda. `COP $265.000.000` → `265000000`.
- **Moneda:** solo `COP`, `USD`, `PEN`, `PAB` o `HNL`.
- **Fechas:** `YYYY-MM-DD`. Las fechas escritas en español ("1 de agosto de 2026") se convierten.
- **`id_contrato`:** tal como aparece en el documento. Si no existe, `AUTO-<año>-<secuencia>`.
- **`region` del comercial no determina `pais`.** El país sale del NIT o del texto del contrato.

## Decisiones tomadas

Mantenerlas salvo que el usuario las cambie. Están documentadas en la conversación y deben reflejarse en `SOLUCION.md`.

- Comercial desconocido: no bloquea el registro; se reporta como aviso.
- Otrosí: no cambia `estado_poliza` automáticamente. Genera una alerta para confirmar que el endoso de la póliza se amplió.
- Otrosí archivado junto al contrato como `<id>-otrosi-<n>.txt`. `ruta_sharepoint` sigue apuntando al contrato base.
- Montos y vigencia de la póliza, cuando aparecen en el contrato, van a `historial.jsonl`. No se amplía el maestro con columnas nuevas.
- Ruta de archivo: `Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>`, con la extensión del adjunto original. No se usa el nombre del adjunto, para que dos mensajes no se sobrescriban.
- SHA-256 del adjunto como evidencia adicional en duplicados. No es regla de bloqueo.
- En actualizaciones se conserva `fecha_registro` original.
- Una actualización con cambio de valor se registra sin confirmación. Se puede agregar un umbral de revisión si se decide.

## Decisiones propuestas, pendientes de confirmar

- msg-004 (duplicado): marcarlo en `out/procesados.json` igual, para que no reaparezca en cada lectura del buzón.
- Alertas: agregar la sección "vencidos sin renovación" para contratos cuya `fecha_fin` ya pasó. El PRD solo pide los que vencen en ≤ 60 días.
- Extensión `.txt` frente a `.pdf`: documentar en `SOLUCION.md` la diferencia con las filas existentes del maestro.
- Moneda de Panamá: `USD` o `PAB`. El fixture usa `USD`. Elegir uno y documentarlo.

## Estado de los casos del buzón

| Mensaje | Resultado esperado | Estado |
|---|---|---|
| msg-001 | `nuevo`, `estado_poliza = pendiente`, CT-2026-015 | Verificado sobre el texto |
| msg-002 | `nuevo`, `estado_poliza = no_aplica` | Pendiente de revisar |
| msg-003 | `actualizacion` de CT-2026-011 (plazo y valor) | Verificado sobre el texto |
| msg-004 | `duplicado` de CT-2026-012, sin escritura | Verificado sobre el texto |
| msg-005 | `rechazado` (cotización) | Pendiente de revisar |
| msg-006 | `nuevo` con `requiere_revision` (valor, `fecha_fin`), remitente no registrado | Pendiente de revisar |

## Salida esperada de alertas (referencia para pruebas)

Con `hoy = 2026-09-03` sobre el maestro original:

- Vencen en ≤ 60 días: CT-2026-009 (2026-09-30) y CT-2026-004 (2026-10-15).
- Pólizas pendientes: CT-2026-004.
- Registrados desde 2026-05-30: ninguno en el maestro original.
- Vencidos sin renovación (propuesta): CT-2025-018 y CT-2026-002.

Cuando se aplique msg-003, CT-2026-011 cambia su `fecha_fin` a 2027-11-01. La salida de alertas debe reflejarlo en la copia de `out/`, nunca en el fixture.

## Reglas de código

- TypeScript con `strict: true` y sin `any`.
- Funciones cortas. Nombres de dominio en español, consistentes con el PRD (`id_contrato`, `nit_cliente`, `fecha_fin`).
- zod para todos los argumentos de herramientas.
- Errores tipados `{ ok: false, error }`. Un mensaje malo no detiene el lote.
- Sin secretos en el repositorio, los logs, el front ni las respuestas de la API. La clave del modelo solo viene de variable de entorno del backend.
- No subir `node_modules/`, `out/` ni `.env`. Sí subir `.env.example`.
- Justificar cada dependencia en `SOLUCION.md`.

## Qué no hacer

- No modificar nada dentro de `fixtures/`.
- No inventar valores, fechas ni identificadores. Si no aparecen en el texto, el campo es `null` con confianza `0`.
- No registrar datos dudosos sin confirmación humana.
- No ampliar el maestro con columnas que el PRD no define.
- No usar `Date.now()` en lógica de negocio.

## Documentación y entrega

- `SOLUCION.md` sigue las 11 secciones de PRD §9.1. La sección 10 (uso de IA) debe declarar que se usó un asistente de IA para construir, incluido este archivo, y para qué tareas.
- Debo poder explicar cada línea que entrego (PRD §0).
- `README.md` documenta cómo levantar el proyecto, las variables de entorno y el link de prueba.
