// Clasificación según RN1–RN4 y umbrales de RN5. Función pura: no escribe nada.
import type { Clasificacion, Comercial, Contrato, Diferencias, FilaMaestro, Validacion } from "./tipos";
import { CONFIANZA_MINIMA, SIMILITUD_MINIMA } from "./tipos";
import { emailNorm, similitud } from "./utilidades";

export const CAMPOS_REVISABLES = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto",
  "valor", "moneda", "fecha_inicio", "fecha_fin",
] as const;
export type CampoRevisable = (typeof CAMPOS_REVISABLES)[number];

// RN5: un campo es revisable si falta (en contratos nuevos y marcos) o tiene confianza < 0.8.
// En un otrosí solo cuentan los campos que el documento menciona.
// Sin monto (valor indeterminado) la moneda no es necesaria.
export function camposARevisar(c: Contrato): CampoRevisable[] {
  const sinMonto = c.campos.valor_indeterminado;
  return CAMPOS_REVISABLES.filter((k) => {
    if (k === "moneda" && sinMonto) return false;
    const valor = c.campos[k];
    if (valor === null) return c.tipo !== "otrosi";
    return (c.confianza[k] ?? 0) < CONFIANZA_MINIMA;
  });
}

export interface EntradaClasificacion {
  contrato: Contrato | null;
  motivoSinContrato?: string;
  remitente: string;
  maestro: FilaMaestro[];
  comerciales: Comercial[];
  anioRef: string;
}

type Parcial = Partial<Omit<Validacion, "avisos" | "comercial">> & { clasificacion: Clasificacion };

function construir(base: Parcial, avisos: string[], comercial: string | null): Validacion {
  return {
    clasificacion: base.clasificacion,
    id_resuelto: base.id_resuelto ?? null,
    requiere_revision: base.requiere_revision ?? [],
    diferencias: base.diferencias ?? {},
    motivo: base.motivo,
    avisos,
    comercial,
  };
}

export function clasificar(e: EntradaClasificacion): Validacion {
  const comercial = e.comerciales.find((c) => emailNorm(c.email) === emailNorm(e.remitente)) ?? null;
  const avisos = [
    ...(comercial ? [] : [`remitente ${e.remitente} no está en el catálogo de comerciales`]),
    ...(e.contrato?.notas ?? []),
  ];
  const nombre = comercial?.nombre ?? null;
  const c = e.contrato;
  if (!c) {
    return construir({ clasificacion: "rechazado", motivo: e.motivoSinContrato ?? "sin adjunto de contrato legible (RN4)" }, avisos, nombre);
  }
  if (!c.campos.id_contrato && !c.campos.nit_cliente && !c.campos.objeto) {
    return construir({ clasificacion: "rechazado", motivo: "texto sin partes ni objeto identificables (RN4)" }, avisos, nombre);
  }
  return c.tipo === "otrosi"
    ? clasificarOtrosi(c, e.maestro, avisos, nombre)
    : clasificarContrato(c, e, avisos, nombre);
}

function diferenciasCon(fila: FilaMaestro, c: Contrato): Diferencias {
  const nuevos: Record<string, unknown> = {
    valor: c.campos.valor,
    moneda: c.campos.moneda,
    fecha_inicio: c.campos.fecha_inicio,
    fecha_fin: c.campos.fecha_fin,
  };
  const dif: Diferencias = {};
  for (const [campo, despues] of Object.entries(nuevos)) {
    if (despues === null || despues === undefined) continue;
    const antes = fila[campo as keyof FilaMaestro];
    if (antes !== despues) dif[campo] = { antes, despues };
  }
  return dif;
}

function clasificarOtrosi(c: Contrato, maestro: FilaMaestro[], avisos: string[], comercial: string | null): Validacion {
  const id = c.campos.id_contrato;
  if (!id) return construir({ clasificacion: "rechazado", motivo: "otrosí sin id del contrato base (RN4)" }, avisos, comercial);
  const fila = maestro.find((f) => f.id_contrato === id);
  if (!fila) return construir({ clasificacion: "rechazado", motivo: `otrosí para contrato no registrado: ${id}` }, avisos, comercial);
  const diferencias = diferenciasCon(fila, c);
  if (Object.keys(diferencias).length === 0) {
    return construir({ clasificacion: "duplicado", id_resuelto: id, motivo: `el otrosí no cambia ningún campo de ${id}` }, avisos, comercial);
  }
  return construir(
    { clasificacion: "actualizacion", id_resuelto: id, requiere_revision: camposARevisar(c), diferencias },
    avisos,
    comercial,
  );
}

function siguienteAuto(maestro: FilaMaestro[], anio: string): string {
  const prefijo = `AUTO-${anio}-`;
  const usados = maestro
    .filter((f) => f.id_contrato.startsWith(prefijo))
    .map((f) => Number(f.id_contrato.slice(prefijo.length)))
    .filter(Number.isInteger);
  return `${prefijo}${String(Math.max(0, ...usados) + 1).padStart(3, "0")}`;
}

function clasificarContrato(c: Contrato, e: EntradaClasificacion, avisos: string[], comercial: string | null): Validacion {
  const idDoc = c.campos.id_contrato;
  const nit = c.campos.nit_cliente;
  const objeto = c.campos.objeto;
  const porId = idDoc ? e.maestro.find((f) => f.id_contrato === idDoc) : undefined;
  // RN2: sin coincidencia por id, se busca mismo NIT con objeto similar (≥ 0.9).
  const porSimilitud = porId
    ? undefined
    : e.maestro.find((f) => nit !== null && f.nit_cliente === nit && objeto !== null && similitud(f.objeto, objeto) >= SIMILITUD_MINIMA);
  const fila = porId ?? porSimilitud;
  // Un id ausente no es revisable: se genera AUTO-<año>-<secuencia>.
  const revision: string[] = camposARevisar(c).filter((k) => k !== "id_contrato" || idDoc !== null);

  if (!fila) {
    const id = idDoc ?? siguienteAuto(e.maestro, e.anioRef);
    return construir({ clasificacion: "nuevo", id_resuelto: id, requiere_revision: revision }, avisos, comercial);
  }
  if (porSimilitud && idDoc) revision.push("id_contrato");
  if (porId && nit && nit !== fila.nit_cliente) revision.push("nit_cliente");

  const diferencias = diferenciasCon(fila, c);
  if (Object.keys(diferencias).length === 0) {
    return construir({ clasificacion: "duplicado", id_resuelto: fila.id_contrato, motivo: `reenvío de ${fila.id_contrato} (RN1)` }, avisos, comercial);
  }
  return construir(
    { clasificacion: "actualizacion", id_resuelto: fila.id_contrato, requiere_revision: revision, diferencias },
    avisos,
    comercial,
  );
}
