# Reto 02 · Registro de contratos vigentes

Agente conversacional que procesa un buzón de correos con contratos, extrae sus datos con nivel de confianza, registra en el maestro simulado, archiva los documentos y genera alertas de vencimiento.

## Requisitos

- **Opción A (local):** Bun 1.1 o superior (`curl -fsSL https://bun.sh/install | bash`).
- **Opción B (Docker):** Docker y Docker Compose.

## Ejecutar en local

```bash
cp .env.example .env          # opcional: añade ANTHROPIC_API_KEY para habilitar el chat
bun install
bun run demo.ts               # verificación sin modelo
bun test                      # pruebas de clasificación y utilidades
bun run dev                   # chat en http://localhost:3000
```

`demo.ts` funciona sin ninguna clave. El chat necesita `ANTHROPIC_API_KEY`.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | Solo para el chat | Clave del proveedor. Nunca se expone al front. |
| `MODELO` | No | Modelo a usar. Por defecto `claude-haiku-5-5`. |
| `HOY` | No | Fecha de referencia del lote (YYYY-MM-DD). |
| `MAX_ITERACIONES` | No | Pasos máximos herramienta-modelo por turno. Por defecto 25. |
| `TOKENS_MAX_SESION` | No | Tope de tokens por sesión. Por defecto 200000. |
| `TOKENS_MAX_GLOBAL` | No | Tope de tokens de todo el servicio. Por defecto 2000000. Se reinicia al reiniciar el servidor. |
| `ACCESO_CLAVE` | No | Si se define, el chat exige esta clave. |
| `DOMINIO` | Solo VPS | Dominio para HTTPS automático con Caddy. |

## Datos de prueba

El repositorio incluye el maestro, el catálogo de comerciales y los seis mensajes del buzón (msg-001 a msg-006) en `fixtures/reto-02/buzon/`. `demo.ts` los procesa en orden.

## Despliegue en un VPS

1. Crear un registro DNS tipo A que apunte tu dominio a la IP del VPS.
2. Abrir los puertos 80 y 443 en el firewall.
3. Instalar Docker y clonar el repositorio.
4. `cp .env.example .env` y completar `ANTHROPIC_API_KEY`, `DOMINIO` y, si aplica, `ACCESO_CLAVE`.
5. `docker compose up -d --build`
6. Abrir `https://tu-dominio` y probar el chat.

Los datos generados quedan en `./out` del host, que es un volumen montado en el contenedor. Para reiniciar el maestro, detener el servicio y borrar `out/`.

## Estructura

```
agent/prompt.md              comportamiento del agente
src/knowledge/               conocimiento del proceso
src/tools/contratos.ts       herramientas tipadas con zod
src/core/                    lógica determinista (sin modelo)
src/llm/                     adaptador del proveedor
src/agent/ciclo.ts           ciclo del agente, tope y confirmación
src/server.ts                API HTTP y estáticos
web/                         front de chat
demo.ts                      verificación sin modelo
fixtures/                    datos entregados (solo lectura)
out/                         salida generada en ejecución
```
