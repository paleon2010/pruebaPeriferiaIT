// API HTTP del chat y estáticos del front. Bun.serve nativo, sin framework.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { inicializar, rutasDe } from "./core/almacen";
import { crearAdaptadorAnthropic } from "./llm/anthropic";
import { cargarSistema, crearSesion, ejecutarTurno, type Sesion } from "./agent/ciclo";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const puerto = Number(env.PORT || 3000);
const hoy = env.HOY || new Date().toISOString().slice(0, 10);
const claveAcceso = env.ACCESO_CLAVE || "";
const maxIteraciones = Number(env.MAX_ITERACIONES || 25);
const maxTokensSesion = Number(env.TOKENS_MAX_SESION || 200000);
// Presupuesto global: el de sesión se reinicia si el cliente cambia de sessionId; este no.
const maxTokensGlobal = Number(env.TOKENS_MAX_GLOBAL || 2000000);
let tokensUsadosGlobal = 0;

// En producción el chat público no arranca sin clave: evita gasto abierto en la clave del proveedor.
if (env.NODE_ENV === "production" && !claveAcceso) {
  throw new Error("En producción ACCESO_CLAVE es obligatoria.");
}

// La clave solo se lee del entorno del servidor; nunca se expone en respuestas ni en el front.
const adaptador = env.ANTHROPIC_API_KEY
  ? crearAdaptadorAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      modelo: env.MODELO || "claude-haiku-5-5",
      timeoutMs: Number(env.TIMEOUT_LLM_MS || 30000),
    })
  : null;

await inicializar(rutasDe(raiz), { limpiar: false });
const sistema = `${await cargarSistema(raiz)}\n\nFecha de referencia del lote: ${hoy}.`;
const sesiones = new Map<string, Sesion>();

const esquemaChat = z.object({
  sessionId: z.string().min(8).max(64),
  message: z.string().min(1).max(2000),
});

const ARCHIVOS: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
};
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" },
  });
}

function autorizado(req: Request): boolean {
  if (!claveAcceso) return true;
  return req.headers.get("authorization") === `Bearer ${claveAcceso}`;
}

function archivoEstatico(nombre: string): Response {
  return new Response(Bun.file(path.join(raiz, "web", nombre)), {
    headers: {
      "content-type": TIPOS[path.extname(nombre)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}

async function chat(req: Request): Promise<Response> {
  if (!adaptador) return json({ ok: false, error: "El modelo no está configurado en el servidor." }, 503);
  const cuerpo = esquemaChat.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return json({ ok: false, error: "Solicitud inválida." }, 400);
  const { sessionId, message } = cuerpo.data;
  if (tokensUsadosGlobal >= maxTokensGlobal) {
    return json({ ok: false, error: "Presupuesto del servicio agotado. Intenta más tarde." }, 429);
  }
  const sesion = sesiones.get(sessionId) ?? crearSesion(sessionId);
  sesiones.set(sessionId, sesion);
  const tokensAntes = sesion.tokens;
  const respuesta = await ejecutarTurno(sesion, message, {
    adaptador,
    sistema,
    maxIteraciones,
    maxTokensSesion,
    ctx: { directory: raiz, sessionId, hoy },
  });
  tokensUsadosGlobal += sesion.tokens - tokensAntes;
  return json(respuesta);
}

Bun.serve({
  port: puerto,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        proveedor: adaptador?.proveedor ?? null,
        modelo: adaptador?.modelo ?? null,
        configurado: adaptador !== null,
        requiereClave: claveAcceso !== "",
      });
    }
    if (url.pathname.startsWith("/api/") && !autorizado(req)) {
      return json({ ok: false, error: "Clave de acceso incorrecta." }, 401);
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return chat(req);
    const sesionUrl = url.pathname.match(/^\/api\/sessions\/([\w-]{8,64})$/);
    if (req.method === "GET" && sesionUrl) {
      const s = sesiones.get(sesionUrl[1]);
      return s ? json({ ok: true, visibles: s.visibles }) : json({ ok: false, error: "Sesión no encontrada." }, 404);
    }
    if (req.method === "GET" && ARCHIVOS[url.pathname]) return archivoEstatico(ARCHIVOS[url.pathname]);
    return json({ ok: false, error: "Ruta no encontrada." }, 404);
  },
  error() {
    return json({ ok: false, error: "Error interno del servidor." }, 500);
  },
});

console.log(`Servidor en http://localhost:${puerto} · modelo: ${adaptador ? "configurado" : "NO configurado"}`);
