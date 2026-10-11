// Extracción determinista (regex) sobre el texto del contrato. Nunca inventa: si no aparece, es null con confianza 0.
import type { Contrato, Correo, PolizaDetalle } from "./tipos";
import { emailNorm, fechaEs, nitLimpio, parseMonto, restarDia, sumarMeses, tituloNombre } from "./utilidades";

const RX = {
  rotulo: /CONTRATO(?: MARCO)?(?: DE PRESTACIÓN DE SERVICIOS)?\s+No\.?\s*((?:CT|CM)-\d{4}-\d{2,3})/i,
  respaldo: /\b((?:CT|CM)-\d{4}-\d{2,3})\b/,
  otrosi: /OTROS[ÍI]/i,
  marco: /CONTRATO MARCO/i,
  // Admite "identificada con NIT X," y la variante corta "NIT X,".
  parte: /Entre(?: los suscritos,)?\s+([^,]+?),\s+(?:identificad[oa]\s+con\s+)?(?:NIT|RUC)\s+([\d.]+(?:-\d)?)/i,
  domicilio: /domicilio en\s+([^,.]+)/i,
  // El monto se busca solo dentro de la cláusula de valor, no en la de garantías.
  clausulaValor: /VALOR\.\s*([^\n]+)/,
  valor: /\((COP|USD|PEN|PAB|HNL)\s*\$?\s*(\d[\d.,]*)\)/,
  indeterminado: /por demanda|indeterminad|no tiene un valor determinado/i,
  inicio: /desde el\s+[^.]*?\((\d{1,2})\)\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i,
  fin: /hasta el\s+[^.]*?\((\d{1,2})\)\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i,
  meses: /(?:plazo|duraci[oó]n) de\s+[^(]*\((\d+)\)\s+meses/i,
  objeto: /OBJETO\.\s*([^\n]+)/,
  porcentajePoliza: /p[oó]liza[^.]*?\((\d+)%\)/i,
  vigenciaPoliza: /vigencia[^.]*?\((\d+)\)\s+meses\s+m[aá]s/i,
};

const PAISES: Array<[RegExp, string]> = [
  [/bogot|medell[ií]n|\bcali\b|barranquilla|colombia/i, "CO"],
  [/\blima\b|per[uú]/i, "PE"],
  [/quito|guayaquil|ecuador/i, "EC"],
  [/panam[aá]/i, "PA"],
  [/tegucigalpa|san pedro sula|honduras/i, "HN"],
];

const TIPOS_POLIZA: Array<[RegExp, string]> = [
  [/p[oó]liza de cumplimiento/i, "cumplimiento"],
  [/p[oó]liza de calidad/i, "calidad"],
  [/responsabilidad civil/i, "responsabilidad_civil"],
  [/salarios y prestaciones/i, "salarios_prestaciones"],
];

// Un adjunto es contrato si tiene la cláusula de partes o es otrosí. Una cotización no lo cumple.
export function esContrato(texto: string): boolean {
  return RX.parte.test(texto) || RX.otrosi.test(texto);
}

function limpiarObjeto(bruto: string): string {
  const sinSujeto = bruto
    .replace(/^EL CONTRATISTA\s+(?:se obliga a ejecutar|prestará el servicio de|prestará servicios de|prestará)\s+/i, "")
    .replace(/\.\s*$/, "")
    .trim();
  return (sinSujeto.charAt(0).toUpperCase() + sinSujeto.slice(1)).slice(0, 200);
}

export function extraerDeTexto(texto: string, correo: Correo): Contrato {
  const tipo: Contrato["tipo"] = RX.otrosi.test(texto) ? "otrosi" : RX.marco.test(texto) ? "marco" : "contrato";
  const confianza: Record<string, number> = {};
  const notas: string[] = [];

  const rotulo = texto.match(RX.rotulo);
  const idMatch = rotulo ?? texto.match(RX.respaldo);
  const id = idMatch ? idMatch[1] : null;
  confianza.id_contrato = rotulo ? 0.98 : id ? 0.6 : 0;

  const parte = texto.match(RX.parte);
  const cliente = parte ? tituloNombre(parte[1]) : null;
  const nit = parte ? nitLimpio(parte[2]) || null : null;
  confianza.cliente = cliente ? 0.95 : 0;
  confianza.nit_cliente = nit ? 0.95 : 0;

  const domicilio = texto.match(RX.domicilio)?.[1] ?? "";
  const pais = PAISES.find(([rx]) => rx.test(domicilio))?.[1] ?? null;
  confianza.pais = pais ? 0.9 : 0;

  const objetoBruto = texto.match(RX.objeto)?.[1];
  const objeto = objetoBruto ? limpiarObjeto(objetoBruto) : null;
  confianza.objeto = objeto ? 0.9 : 0;

  const clausula = texto.match(RX.clausulaValor)?.[1] ?? texto;
  const vMatch = clausula.match(RX.valor);
  const indeterminado = !vMatch && RX.indeterminado.test(texto);
  const valorNumerico = vMatch ? parseMonto(vMatch[2]) : null;
  const valor = indeterminado ? 0 : valorNumerico;
  confianza.valor = indeterminado ? 0.5 : valorNumerico !== null ? 0.9 : 0;
  const moneda = vMatch ? vMatch[1] : null;
  confianza.moneda = moneda ? 0.9 : 0;

  const iMatch = texto.match(RX.inicio);
  const fMatch = texto.match(RX.fin);
  const mMatch = texto.match(RX.meses);
  const inicio = iMatch ? fechaEs(iMatch[1], iMatch[2], iMatch[3]) : null;
  let fin: string | null = null;
  if (fMatch) fin = fechaEs(fMatch[1], fMatch[2], fMatch[3]);
  else if (mMatch && inicio) fin = restarDia(sumarMeses(inicio, Number(mMatch[1])));
  confianza.fecha_inicio = inicio ? 0.9 : 0;
  confianza.fecha_fin = fin ? (fMatch ? 0.9 : 0.6) : 0;

  // En un marco la póliza se exige por orden de servicio, no por el contrato marco.
  const tipos = tipo === "marco" ? [] : TIPOS_POLIZA.filter(([rx]) => rx.test(texto)).map(([, t]) => t);
  const requierePoliza = tipos.length > 0;
  if (tipo === "marco" && /p[oó]liza/i.test(texto)) {
    const pct = texto.match(RX.porcentajePoliza)?.[1] ?? "?";
    notas.push(`póliza de cumplimiento del ${pct}% exigida por orden de servicio; no aplica al marco`);
  }
  let poliza: PolizaDetalle | null = null;
  const pMatch = texto.match(RX.porcentajePoliza);
  if (requierePoliza && pMatch && valor) {
    const vig = texto.match(RX.vigenciaPoliza);
    const mesesAdicionales = vig ? Number(vig[1]) : null;
    poliza = {
      porcentaje: Number(pMatch[1]),
      monto: Math.round((valor * Number(pMatch[1])) / 100),
      meses_adicionales: mesesAdicionales,
      vigencia_hasta: fin && mesesAdicionales !== null ? sumarMeses(fin, mesesAdicionales) : null,
    };
  }

  return {
    tipo,
    campos: {
      id_contrato: id,
      cliente,
      nit_cliente: nit,
      pais,
      objeto,
      valor,
      valor_indeterminado: indeterminado,
      moneda,
      fecha_inicio: inicio,
      fecha_fin: fin,
      requiere_poliza: requierePoliza,
      tipo_poliza: tipos.join(";"),
      poliza,
      comercial_email: emailNorm(correo.de),
    },
    confianza,
    notas,
  };
}
