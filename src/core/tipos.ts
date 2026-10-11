// Constantes y tipos del dominio (PRD §3, §6, §7).

export const CONFIANZA_MINIMA = 0.8;
export const SIMILITUD_MINIMA = 0.9;
export const VENTANA_VENCIMIENTO_DIAS = 60;
export const CORTE_GAP = "2026-05-30";
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const;

export const COLUMNAS_MAESTRO = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza",
  "comercial", "ruta_sharepoint", "fecha_registro", "fuente",
] as const;

export interface FilaMaestro {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: string;
  objeto: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: boolean;
  tipo_poliza: string;
  estado_poliza: string;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: string;
}

export interface Comercial {
  email: string;
  nombre: string;
  region: string;
}

export interface Correo {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
}

export interface PolizaDetalle {
  porcentaje: number;
  monto: number;
  meses_adicionales: number | null;
  vigencia_hasta: string | null;
}

export interface CamposContrato {
  id_contrato: string | null;
  cliente: string | null;
  nit_cliente: string | null;
  pais: string | null;
  objeto: string | null;
  valor: number | null;
  valor_indeterminado: boolean;
  moneda: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  requiere_poliza: boolean;
  tipo_poliza: string;
  poliza: PolizaDetalle | null;
  comercial_email: string;
}

export interface Contrato {
  tipo: "contrato" | "otrosi" | "marco";
  campos: CamposContrato;
  confianza: Record<string, number>;
  notas: string[];
}

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado";

export type Diferencias = Record<string, { antes: unknown; despues: unknown }>;

export interface Validacion {
  clasificacion: Clasificacion;
  id_resuelto: string | null;
  requiere_revision: string[];
  avisos: string[];
  diferencias: Diferencias;
  motivo?: string;
  comercial: string | null;
}

// Resultado uniforme de todas las herramientas: nunca se lanza una excepción hacia el modelo.
export type Resultado =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; requiere_confirmacion?: string[]; valores_propuestos?: Record<string, unknown> };
