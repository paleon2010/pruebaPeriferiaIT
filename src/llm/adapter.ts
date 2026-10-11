// Interfaz propia del proveedor (PRD §6.1). Cambiar de proveedor no debe tocar el ciclo del agente.

export interface LlamadaLLM {
  id: string;
  nombre: string;
  entrada: unknown;
}

export interface ResultadoLLM {
  id: string;
  contenido: string;
}

export type MensajeLLM =
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaLLM[] }
  | { rol: "herramientas"; resultados: ResultadoLLM[] };

export interface DefHerramientaLLM {
  nombre: string;
  descripcion: string;
  esquemaJson: Record<string, unknown>;
}

export type RespuestaLLM =
  | { ok: true; texto: string; llamadas: LlamadaLLM[]; tokens: number }
  | { ok: false; error: string };

export interface AdaptadorLLM {
  proveedor: string;
  modelo: string;
  enviar(mensajes: MensajeLLM[], herramientas: DefHerramientaLLM[], sistema: string): Promise<RespuestaLLM>;
}
