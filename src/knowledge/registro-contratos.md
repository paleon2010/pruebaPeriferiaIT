# Proceso: registro de contratos vigentes

Periferia IT Group registra sus contratos vigentes en un maestro (fuente de verdad) que hoy es un CSV simulando SharePoint. El proceso sobrevive a la rotación de personas: el buzón `contratos@` es el único punto de entrada.

## Qué llega al buzón

- Contratos firmados con su texto (adjunto `contrato.txt`).
- Otrosíes que modifican plazo o valor de un contrato ya registrado.
- Reenvíos de contratos que ya están en el maestro.
- Correos sin contrato, como cotizaciones o preguntas.

## Reglas de clasificación

- **Duplicado:** mismo `id_contrato` y mismos `valor`, `fecha_inicio` y `fecha_fin`. No se escribe nada.
- **Actualización:** mismo `id_contrato`, o mismo NIT con objeto similar (≥ 0.9), con algún campo distinto. También es actualización todo otrosí de un contrato registrado. Se modifica la fila y se registra el cambio en el historial.
- **Nuevo:** no hay coincidencia. Se inserta. Si no trae id, se asigna `AUTO-<año>-<secuencia>`.
- **Rechazado:** sin adjunto de contrato, o sin partes ni objeto identificables.

## Campos en revisión

Un campo con confianza menor a 0.8, o ausente en un contrato nuevo, no se registra sin confirmación humana. La analista confirma o corrige, y el valor registrado sale de la herramienta más lo que ella escribió, nunca de una estimación.

## Alertas

- Contratos que vencen en 60 días o menos.
- Contratos que requieren póliza y no están en estado `vigente`.
- Registros desde el 2026-05-30, que cubren el gap de junio a agosto.
- Contratos cuya fecha de fin ya pasó y siguen marcados como vigentes (propuesta).

## Regla de gobierno (resumen)

Todo contrato firmado debe enviarse al buzón único. Ningún contrato entra al maestro sin comercial identificado en el catálogo. Los cambios a un contrato existente solo entran por otrosí. Todo cambio deja rastro: quién, cuándo, qué documento y por qué.
