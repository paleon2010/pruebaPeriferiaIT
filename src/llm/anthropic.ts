// Implementación del adaptador para la API de Anthropic (Messages API con tool use).
import type { AdaptadorLLM, DefHerramientaLLM, MensajeLLM, RespuestaLLM } from "./adapter";

interface BloqueRespuesta {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface RespuestaAPI {
  content?: BloqueRespuesta[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

function aFormato(m: MensajeLLM): Record<string, unknown> {
  if (m.rol === "usuario") return { role: "user", content: m.texto };
  if (m.rol === "herramientas") {
    return {
      role: "user",
      content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido })),
    };
  }
  return {
    role: "assistant",
    content: [
      ...(m.texto ? [{ type: "text", text: m.texto }] : []),
      ...m.llamadas.map((l) => ({ type: "tool_use", id: l.id, name: l.nombre, input: l.entrada })),
    ],
  };
}

export function crearAdaptadorAnthropic(op: { apiKey: string; modelo: string; timeoutMs: number }): AdaptadorLLM {
  return {
    proveedor: "anthropic",
    modelo: op.modelo,
    async enviar(mensajes: MensajeLLM[], herramientas: DefHerramientaLLM[], sistema: string): Promise<RespuestaLLM> {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": op.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: op.modelo,
            max_tokens: 1024,
            system: sistema,
            messages: mensajes.map(aFormato),
            ...(herramientas.length
              ? {
                  tools: herramientas.map((h) => ({
                    name: h.nombre,
                    description: h.descripcion,
                    input_schema: h.esquemaJson,
                  })),
                }
              : {}),
          }),
          signal: AbortSignal.timeout(op.timeoutMs),
        });
        if (!res.ok) return { ok: false, error: `el proveedor respondió con estado ${res.status}` };

        const datos = (await res.json()) as RespuestaAPI;
        const bloques = datos.content ?? [];
        const llamadas = bloques
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: b.id ?? "", nombre: b.name ?? "", entrada: b.input ?? {} }));
        const texto = bloques
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")
          .trim();
        const tokens = (datos.usage?.input_tokens ?? 0) + (datos.usage?.output_tokens ?? 0);
        return {
          ok: true,
          texto: texto || (llamadas.length ? "" : "No obtuve respuesta del modelo."),
          llamadas,
          tokens,
        };
      } catch (e) {
        const expiro = e instanceof DOMException && e.name === "TimeoutError";
        return { ok: false, error: expiro ? "el modelo tardó demasiado en responder" : "no se pudo contactar al proveedor" };
      }
    },
  };
}
