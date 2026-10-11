# SOLUCION · Reto 02 · Registro de contratos vigentes

> **Estado de verificación:** el código se generó pero no se ejecutó en el entorno de desarrollo (sin acceso a red para instalar dependencias). Antes de la entrega, correr `bun test` y `bun run demo.ts` y revisar la salida contra la sección 7.4 del PRD.

## 1. Problema

El maestro de contratos vigentes de Periferia está congelado desde el 30 de mayo de 2026, porque dependía de una persona que ya no está. Los comerciales solo envían a administración los contratos con póliza. Quien más lo sufre es la analista administrativa, que no puede responder qué contratos vencen ni qué pólizas están pendientes.

## 2. Arquitectura

```
Front de chat (web/)  ──HTTP──▶  Servidor (src/server.ts)
                                    │
                                    ▼
                          Ciclo del agente (src/agent/ciclo.ts)
                          │  prompt: agent/prompt.md
                          │  conocimiento: src/knowledge/
                          │  adaptador: src/llm/ (Anthropic)
                          ▼
                 Herramientas con zod (src/tools/contratos.ts)
                          │  contratos_leer_buzon / extraer / validar / registrar / alertas
                          ▼
                 Núcleo determinista (src/core/)
                 extraer · clasificar · registrar · alertas
                          │
             fixtures/ (solo lectura)      out/ (escritura: maestro, historial, log)
```

El modelo solo decide qué herramienta llamar. Los valores que puede afirmar salen de las herramientas, y el núcleo es el mismo que usa `demo.ts`, sin modelo.

## 3. Ciclo del agente

1. El usuario escribe en el chat. El servidor agrega el mensaje a la sesión.
2. Se llama al modelo con el historial, las definiciones de herramientas y el system prompt.
3. Si el modelo pide herramientas, cada una se valida con zod. Si los argumentos no cumplen, el error vuelve al modelo como resultado.
4. Los resultados se devuelven al modelo. El ciclo se repite hasta 25 veces por turno (CA1).
5. Si una herramienta requiere confirmación humana, el turno termina con una pregunta explícita y el front la resalta (CA3).
6. Toda llamada queda en el historial visible y en `out/log.jsonl` (CA4).
7. Si el proveedor falla o se agota el presupuesto de tokens, el error se muestra en el chat y la sesión sigue activa (CA5).

## 4. Elección del modelo

- **Proveedor:** Anthropic, por la API de tool use y por el manejo de errores estructurados.
- **Modelo:** `claude-haiku-5-5` por defecto. Es el más rápido y barato para clasificar y resumir. Para casos ambiguos o conversación más compleja, se puede cambiar con `MODELO` sin tocar código.
- **Costo estimado:** el costo por turno depende del tamaño del system prompt, las definiciones de herramientas y el texto del contrato. El cálculo es `(tokens de entrada + tokens de salida) × precio por token del modelo elegido`. El servidor suma ambos valores por sesión y corta al llegar a `TOKENS_MAX_SESION`. El precio vigente debe tomarse de la página de precios del proveedor.
- **Costo del núcleo:** cero. `demo.ts` y la lógica de clasificación no consumen tokens.

## 5. Estrategia de extracción

- **Dónde entra el modelo:** solo en la conversación, para decidir qué herramienta llamar y para redactar la pregunta de confirmación.
- **Dónde no entra:** la extracción de partes, NIT, valor, moneda, fechas, póliza y objeto es determinista, con expresiones regulares sobre `contrato.txt`. Los valores se verifican contra su forma escrita cuando el contrato la incluye.
- **Confianza:** cada campo tiene un puntaje fijo según la regla que lo encontró. Un valor explícito con su forma escrita recibe 0.9. Un identificador con su rótulo recibe 0.98. Un plazo calculado a partir de meses recibe 0.6. Un valor "por demanda" recibe 0.5. Un campo no encontrado recibe 0 y se deja en `null`.
- **Umbral:** campos con confianza menor a 0.8 van a revisión humana (RN5).
- **Póliza:** se detecta por el tipo, se calcula el monto a partir del porcentaje y la vigencia a partir de los meses adicionales. Ese detalle se guarda en el historial, no en el maestro (ver decisiones).

## 6. Regla de gobierno

Propuesta para el manejo corporativo de los contratos:

1. **Canal único:** `contratos@periferia-ficticia.com`. Lo administra la analista administrativa. La gerencia es el respaldo.
2. **Obligación del comercial:** enviar al buzón el contrato firmado, cada otrosí y cada acta de terminación, dentro de 5 días hábiles desde la firma. Asunto con formato `CT-AAAA-NNN | Cliente | Tipo`. *Plazo y formato son propuestas a validar con el área comercial.*
3. **Acuse automático:** el agente registra y responde al comercial con el resultado. *El envío de correos no está implementado; es parte de la propuesta.*
4. **Excepciones y escalamiento:** un contrato sin firma se deja en revisión y se escala a gerencia. Un contrato sin valor se registra con `valor_indeterminado` y queda en revisión. Un remitente fuera del catálogo se da de alta antes de registrar.
5. **Cierre del gap:** una campaña única pide a los comerciales la lista de contratos firmados entre el 1 de junio y el 31 de agosto de 2026, la cruza con el maestro y los ingresa por el buzón. Plazo propuesto: 10 días hábiles.
6. **Indicador mensual:** porcentaje de contratos facturados que existen en el maestro. Si baja del 95 %, se revisa el proceso.
7. **Dueño del maestro:** pregunta abierta del PRD. Propuesta: la analista administrativa administra; la gerencia aprueba las reglas.

## 7. Decisiones y trade-offs

1. **`contratos_registrar` no recibe el contrato desde el modelo.** El PRD sugiere pasarlo como argumento. Se descartó porque permitiría que el modelo escribiera un valor que no salió de la extracción (CA2). Ahora la herramienta recalcula desde el adjunto; el único dato que el modelo puede aportar son las correcciones que la analista escribe, y esas solo se aceptan con confirmación explícita.
2. **Extracción con expresiones regulares, no con el modelo.** Es más rígida: un contrato con redacción distinta puede quedar sin campos y pasar a revisión. A cambio, es reproducible, gratis y verificable en `demo.ts`. El modelo puede mejorar la cobertura más adelante sin tocar el maestro.
3. **Maestro en CSV, sin base de datos.** Es lo que pide el PRD. Se descartó SQLite porque el enunciado excluye la base de datos y el CSV es legible por la analista.
4. **Historial en JSON Lines.** Cada cambio es una línea independiente, sin reescribir el archivo, y cada línea se puede auditar por separado.
5. **Correcciones de la analista con confianza 1.** Se descartó un flujo interactivo dentro de la herramienta porque obliga a mantener estado. La confirmación pasa por dos llamadas: la primera propone y la segunda registra.
6. **Duplicados y rechazados se marcan como procesados.** Si no, aparecerían en cada lectura del buzón. Queda como decisión pendiente de confirmar con la analista.
7. **Modelo pequeño por defecto.** Haiku es suficiente para decidir herramientas. Se descartó Sonnet como valor por defecto por costo, aunque se puede cambiar con una variable.
8. **Contrato marco como tipo propio.** Un marco no tiene valor ni póliza propia: la póliza se exige por cada orden de servicio. Tratarlo como contrato normal generaría una póliza pendiente que no corresponde. Se registra como `marco`, con valor indeterminado y la póliza como nota, no como estado.
9. **Despliegue en Railway.** El proyecto se despliega con Docker y un volumen montado en `out/`, que conserva el maestro, el historial, el log y el presupuesto entre reinicios. Se descartó Netlify porque sus funciones no conservan archivos ni estado en memoria, y el proyecto depende de ambos.

## 8. Supuestos

- Los contratos llegan como `.txt` con texto (no escaneados), según el PRD (§3.2).
- El valor "IVA incluido" se registra tal cual; el maestro no distingue si el valor incluye impuestos.
- `pais` se infiere del domicilio del contratante. La región del comercial nunca determina el país.
- La fecha de referencia del lote se pasa como argumento; no se usa la hora del sistema en la lógica de negocio.
- Un otrosí no cambia `estado_poliza`. Genera un aviso para confirmar que la póliza se amplió.
- La extensión del archivo archivado es la del adjunto original, aunque las filas del fixture apunten a `.pdf`.
- La moneda de Panamá se registra como `USD`, como en el fixture.
- En msg-006 (contrato marco) la fecha de inicio no aparece en el texto: el plazo corre desde la firma. Queda en revisión y se confirma con la analista. La fecha acordada es 2026-09-01.

## 9. Cobertura

| Historia | Estado | Observación |
|---|---|---|
| HU-1 Leer buzón | Hecho | Sin ejecución verificada. |
| HU-2 Extraer datos | Hecho | Regex determinista; enriquecimiento con modelo no implementado. |
| HU-3 Validar y clasificar | Hecho | RN1–RN4 implementadas. RN2 usa similitud de Dice. |
| HU-4 Registrar y archivar | Hecho | Sin ejecución verificada. |
| HU-5 Alertas | Hecho | Incluye la sección de vencidos como propuesta. |
| HU-6 Manejo de errores | Hecho | Las herramientas nunca lanzan. El lote continúa. |
| `contratos_leer_pdf` (P1) | No implementado | Opcional según el PRD. |
| Bonus módulo reutilizable (§9.4) | No implementado | Pendiente. |

Para producción faltan: lectura de PDF escaneado con OCR, envío real de acuses por correo, autenticación de usuarios, persistencia en base de datos con transacciones, y pruebas sobre los seis mensajes completos.

## 10. Uso de IA

- **Asistente:** Claude (Anthropic), en una conversación de diseño y generación del repositorio.
- **Tareas:** lectura del PRD, diseño de la arquitectura, escritura de código y documentación, y revisión de los casos del buzón contra las reglas.
- **Descartado:** la propuesta inicial de un agente con reglas embebidas en el código, reemplazada por el diseño con `agent/prompt.md` y `src/knowledge/` separados, como pide el PRD.
- **Revisión:** el código debe leerse y probarse antes de la entrega. El candidato debe poder explicar cada línea.

*Completar con cualquier otro asistente que se haya usado.*

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo inventa un valor | Los valores salen solo de herramientas. El modelo solo propone. |
| Falsos duplicados por cambio de nombre del cliente | Dedupe por NIT antes que por nombre. |
| Contrato con redacción no prevista deja campos vacíos | Pasa a revisión humana; no se registra con datos malos. |
| Abuso del chat público y costo descontrolado | Tope de iteraciones, tope de tokens por sesión y clave opcional. |
| Pérdida del maestro | Copia en `out/`; respaldo del volumen y de `historial.jsonl`. |
| Concurrencia en el mismo maestro | El servidor procesa un turno a la vez por sesión, pero no coordina sesiones entre sí. Para producción se necesita bloqueo de archivo o base de datos. |
