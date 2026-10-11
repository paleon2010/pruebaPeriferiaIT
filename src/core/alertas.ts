// Reporte de vencimientos, pólizas y gap (HU-5). La fecha de referencia es un argumento: demo determinista.
import { CORTE_GAP, VENTANA_VENCIMIENTO_DIAS, type FilaMaestro } from "./tipos";
import { diasEntre } from "./utilidades";

export interface ItemAlerta {
  id_contrato: string;
  cliente: string;
  fecha_fin: string;
  dias: number;
  estado_poliza: string;
  comercial: string;
}

export interface Alertas {
  vencen: ItemAlerta[];
  vencidos: ItemAlerta[];
  polizas_pendientes: ItemAlerta[];
  registrados_desde_corte: ItemAlerta[];
}

export function calcularAlertas(filas: FilaMaestro[], hoy: string): Alertas {
  const dias = (f: FilaMaestro): number => diasEntre(hoy, f.fecha_fin);
  const item = (f: FilaMaestro): ItemAlerta => ({
    id_contrato: f.id_contrato,
    cliente: f.cliente,
    fecha_fin: f.fecha_fin,
    dias: dias(f),
    estado_poliza: f.estado_poliza,
    comercial: f.comercial,
  });
  return {
    vencen: filas.filter((f) => dias(f) >= 0 && dias(f) <= VENTANA_VENCIMIENTO_DIAS).map(item),
    // Propuesta fuera del PRD: contratos cuya fecha de fin ya pasó y siguen marcados como vigentes.
    vencidos: filas.filter((f) => f.fecha_fin < hoy).map(item),
    polizas_pendientes: filas.filter((f) => f.requiere_poliza && f.estado_poliza !== "vigente").map(item),
    registrados_desde_corte: filas.filter((f) => f.fecha_registro >= CORTE_GAP).map(item),
  };
}

function seccion(titulo: string, items: ItemAlerta[]): string {
  const lineas = items.length
    ? items.map((i) => `- ${i.id_contrato} · ${i.cliente} · fin ${i.fecha_fin} · póliza ${i.estado_poliza} · ${i.comercial}`)
    : ["_Sin registros._"];
  return [`## ${titulo}`, "", ...lineas, ""].join("\n");
}

export function markdownAlertas(a: Alertas, hoy: string): string {
  return [
    "# Alertas de contratos",
    "",
    `Fecha de referencia: ${hoy}`,
    "",
    seccion(`Vencen en ≤ ${VENTANA_VENCIMIENTO_DIAS} días`, a.vencen),
    seccion("Pólizas pendientes", a.polizas_pendientes),
    seccion(`Registrados desde ${CORTE_GAP} (gap cubierto)`, a.registrados_desde_corte),
    seccion("Vencidos sin renovación (propuesta)", a.vencidos),
  ].join("\n");
}
