// Herramientas del agente (PRD §6.2). Nombre expuesto al modelo: contratos_<clave>. Nunca lanzan excepciones.
import { z } from "zod";
import { analizarMensaje, buscarContrato } from "../core/analizar";
import { escribirAlertas, leerMaestro, leerProcesados, listarMensajes, leerCorreo, rutasDe } from "../core/almacen";
import { calcularAlertas, markdownAlertas } from "../core/alertas";
import { registrarMensaje } from "../core/registrar";
import { MONEDAS, type Resultado } from "../core/tipos";

export interface Contexto {
  directory: string;
  sessionId: string;
  hoy: string;
}

export interface DefHerramienta {
  description: string;
  args: z.ZodObject;
  execute(entrada: unknown, ctx: Contexto): Promise<string>;
}

// Envuelve cada herramienta: valida argumentos con zod y convierte cualquier error en { ok: false, error }.
function herramienta<T extends z.ZodObject>(
  descripcion: string,
  args: T,
  ejecutar: (a: z.infer<T>, ctx: Contexto) => Promise<Resultado>,
): DefHerramienta {
  return {
    description: descripcion,
    args,
    async execute(entrada, ctx) {
      const parseo = args.safeParse(entrada);
      if (!parseo.success) {
        const detalle = parseo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return JSON.stringify({ ok: false, error: `argumentos inválidos: ${detalle}` });
      }
      try {
        return JSON.stringify(await ejecutar(parseo.data, ctx));
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error desconocido" });
      }
    },
  };
}

const mensajeId = z
  .string()
  .regex(/^msg-\d{3}$/, "formato msg-NNN")
  .describe("Identificador del mensaje del buzón, por ejemplo msg-001");

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "formato YYYY-MM-DD")
  .describe("Fecha en formato YYYY-MM-DD");

const esquemaCorrecciones = z
  .object({
    id_contrato: z.string().regex(/^[A-Z0-9-]+$/).optional(),
    cliente: z.string().min(2).optional(),
    nit_cliente: z.string().regex(/^\d+$/).optional(),
    objeto: z.string().max(200).optional(),
    valor: z.number().nonnegative().optional(),
    moneda: z.enum(MONEDAS).optional(),
    fecha_inicio: fecha.optional(),
    fecha_fin: fecha.optional(),
  })
  .describe("Valores que la analista escribió para corregir o completar campos. Solo válidos con confirmado = true.");

export const leer_buzon = herramienta(
  "Lista los mensajes del buzón que aún no se han procesado e indica si cada uno trae un contrato.",
  z.object({}),
  async (_a, ctx) => {
    const r = rutasDe(ctx.directory);
    const procesados = await leerProcesados(r);
    const mensajes: Array<Record<string, unknown>> = [];
    for (const id of await listarMensajes(r)) {
      if (procesados.includes(id)) continue;
      const correo = await leerCorreo(r, id);
      const adjunto = await buscarContrato(r, id, correo);
      mensajes.push({
        id,
        de: correo.de,
        asunto: correo.asunto,
        fecha: correo.fecha,
        adjuntos: correo.adjuntos,
        tiene_contrato: adjunto !== null,
      });
    }
    return { ok: true, data: { mensajes } };
  },
);

export const extraer = herramienta(
  "Extrae los datos estructurados de un contrato del buzón, con la confianza de cada campo.",
  z.object({ mensaje_id: mensajeId }),
  async (a, ctx) => {
    const analisis = await analizarMensaje(rutasDe(ctx.directory), a.mensaje_id, ctx.hoy);
    if (!analisis.contrato) return { ok: false, error: "el mensaje no contiene un contrato legible" };
    return {
      ok: true,
      data: {
        mensaje_id: a.mensaje_id,
        adjunto: analisis.adjunto?.nombre ?? null,
        tipo: analisis.contrato.tipo,
        campos: analisis.contrato.campos,
        confianza: analisis.contrato.confianza,
      },
    };
  },
);

export const validar = herramienta(
  "Clasifica un mensaje del buzón como nuevo, actualización, duplicado o rechazado, sin escribir nada.",
  z.object({ mensaje_id: mensajeId }),
  async (a, ctx) => {
    const analisis = await analizarMensaje(rutasDe(ctx.directory), a.mensaje_id, ctx.hoy);
    return {
      ok: true,
      data: { mensaje_id: a.mensaje_id, adjunto: analisis.adjunto?.nombre ?? null, ...analisis.validacion },
    };
  },
);

export const registrar = herramienta(
  "Registra un mensaje en el maestro si está limpio. Si tiene campos en revisión no escribe, salvo que la analista confirme.",
  z.object({
    mensaje_id: mensajeId,
    confirmado: z.boolean().optional().describe("true solo si la analista confirmó explícitamente los campos en revisión"),
    correcciones: esquemaCorrecciones.optional(),
  }),
  async (a, ctx) =>
    registrarMensaje(rutasDe(ctx.directory), a.mensaje_id, {
      hoy: ctx.hoy,
      confirmado: a.confirmado ?? false,
      correcciones: a.correcciones,
    }),
);

export const alertas = herramienta(
  "Genera out/alertas.md con contratos que vencen en 60 días, pólizas pendientes, registros desde el corte y vencidos.",
  z.object({ hoy: fecha.describe("Fecha de referencia del reporte, YYYY-MM-DD") }),
  async (a, ctx) => {
    const r = rutasDe(ctx.directory);
    const resultado = calcularAlertas(await leerMaestro(r), a.hoy);
    await escribirAlertas(r, markdownAlertas(resultado, a.hoy));
    return { ok: true, data: { ruta: "out/alertas.md", ...resultado } };
  },
);

// Registro usado por el ciclo del agente y por demo.ts: misma definición, mismos nombres.
export const herramientas = { leer_buzon, extraer, validar, registrar, alertas };

export function registroNombrado(): Map<string, DefHerramienta> {
  return new Map(
    Object.entries(herramientas).map(([clave, h]): [string, DefHerramienta] => [`contratos_${clave}`, h]),
  );
}
