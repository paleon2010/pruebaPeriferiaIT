// Ciclo del agente (PRD §6.3): prompt -> modelo -> herramientas -> respuesta, con tope de iteraciones
// y confirmación humana (CA3). Ninguna excepción sale de aquí: los errores se devuelven como texto.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AdaptadorLLM, DefHerramientaLLM, LlamadaLLM, MensajeLLM, ResultadoLLM } from "../llm/adapter";
import { registroNombrado, type Contexto, type DefHerramienta } from "../tools/contratos";

export interface LlamadaVisible {
  nombre: string;
  entrada: unknown;
  ok: boolean;
  resumen: string;
}

export interface TurnoVisible {
  rol: "usuario" | "asistente";
  texto: string;
  llamadas: LlamadaVisible[];
}

export interface Sesion {
  id: string;
  mensajes: MensajeLLM[];
  visibles: TurnoVisible[];
  tokens: number;
}

export interface RespuestaTurno {
  reply: string;
  toolCalls: LlamadaVisible[];
  needsConfirmation: boolean;
  error?: string;
}

export interface Dependencias {
  adaptador: AdaptadorLLM;
  sistema: string;
  maxIteraciones: number;
  maxTokensSesion: number;
  ctx: Contexto;
}

const registro = registroNombrado();

export function definicionesLLM(): DefHerramientaLLM[] {
  return [...registro.entries()].map(([nombre, h]) => {
    const esquema = z.toJSONSchema(h.args) as Record<string, unknown>;
    delete esquema.$schema;
    return { nombre, descripcion: h.description, esquemaJson: esquema };
  });
}

export async function cargarSistema(raiz: string): Promise<string> {
  const prompt = await readFile(path.join(raiz, "agent", "prompt.md"), "utf8");
  const conocimiento = await readFile(path.join(raiz, "src", "knowledge", "registro-contratos.md"), "utf8");
  return `${prompt}\n\n---\n\n${conocimiento}`;
}

export function crearSesion(id: string): Sesion {
  return { id, mensajes: [], visibles: [], tokens: 0 };
}

interface ResultadoEjecucion {
  contenido: string;
  ok: boolean;
  resumen: string;
  confirmacion: boolean;
}

async function ejecutar(l: LlamadaLLM, ctx: Contexto): Promise<ResultadoEjecucion> {
  const def: DefHerramienta | undefined = registro.get(l.nombre);
  if (!def) {
    const error = `herramienta desconocida: ${l.nombre}`;
    return { contenido: JSON.stringify({ ok: false, error }), ok: false, resumen: error, confirmacion: false };
  }
  const contenido = await def.execute(l.entrada, ctx);
  const res = JSON.parse(contenido) as {
    ok: boolean;
    data?: unknown;
    error?: string;
    requiere_confirmacion?: string[];
  };
  return {
    contenido,
    ok: res.ok,
    resumen: res.ok ? JSON.stringify(res.data ?? null).slice(0, 240) : (res.error ?? "error"),
    confirmacion: (res.requiere_confirmacion?.length ?? 0) > 0,
  };
}

function cerrar(s: Sesion, texto: string, llamadas: LlamadaVisible[], confirmacion: boolean, error?: string): RespuestaTurno {
  s.visibles.push({ rol: "asistente", texto, llamadas });
  return { reply: texto, toolCalls: llamadas, needsConfirmation: confirmacion, ...(error ? { error } : {}) };
}

export async function ejecutarTurno(s: Sesion, texto: string, dep: Dependencias): Promise<RespuestaTurno> {
  s.mensajes.push({ rol: "usuario", texto });
  s.visibles.push({ rol: "usuario", texto, llamadas: [] });
  const llamadasTurno: LlamadaVisible[] = [];
  let confirmar = false;

  for (let i = 0; i < dep.maxIteraciones; i++) {
    if (s.tokens >= dep.maxTokensSesion) {
      return cerrar(s, "Se alcanzó el presupuesto de tokens de esta sesión.", llamadasTurno, false, "presupuesto agotado");
    }
    const r = await dep.adaptador.enviar(s.mensajes, definicionesLLM(), dep.sistema);
    if (!r.ok) {
      return cerrar(s, `No pude completar la respuesta: ${r.error}.`, llamadasTurno, false, r.error);
    }
    s.tokens += r.tokens;
    s.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas });
    if (r.llamadas.length === 0) return cerrar(s, r.texto, llamadasTurno, false);

    const resultados: ResultadoLLM[] = [];
    for (const l of r.llamadas) {
      const e = await ejecutar(l, dep.ctx);
      llamadasTurno.push({ nombre: l.nombre, entrada: l.entrada, ok: e.ok, resumen: e.resumen });
      confirmar = confirmar || e.confirmacion;
      resultados.push({ id: l.id, contenido: e.contenido });
    }
    s.mensajes.push({ rol: "herramientas", resultados });

    if (confirmar) {
      // CA3: el turno termina con una pregunta explícita. Se pide sin herramientas para que no siga actuando.
      const instruccion =
        "\n\nEn este turno no hay herramientas disponibles. Redacta la pregunta de confirmación: para cada campo en revisión indica el valor propuesto (valores_propuestos) y pide a la analista confirmarlo o corregirlo. Termina con una pregunta clara.";
      const cierre = await dep.adaptador.enviar(s.mensajes, [], dep.sistema + instruccion);
      if (!cierre.ok) {
        return cerrar(s, "Necesito tu confirmación para continuar, pero no pude redactar la pregunta.", llamadasTurno, true);
      }
      s.tokens += cierre.tokens;
      s.mensajes.push({ rol: "asistente", texto: cierre.texto, llamadas: [] });
      return cerrar(s, cierre.texto, llamadasTurno, true);
    }
  }
  return cerrar(
    s,
    "Alcancé el límite de pasos para este turno. Revisa las llamadas anteriores y vuelve a pedirme lo que falta.",
    llamadasTurno,
    false,
    "límite de iteraciones",
  );
}
