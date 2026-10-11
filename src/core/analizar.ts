// Pipeline de lectura: correo -> adjunto de contrato -> extracción -> clasificación. No escribe.
import { leerCorreo, leerComerciales, leerMaestro, leerTextoAdjunto, type Rutas } from "./almacen";
import { clasificar } from "./clasificar";
import { esContrato, extraerDeTexto } from "./extraer";
import type { Contrato, Correo, Validacion } from "./tipos";

export interface AdjuntoContrato {
  nombre: string;
  texto: string;
}

export interface Analisis {
  correo: Correo;
  adjunto: AdjuntoContrato | null;
  contrato: Contrato | null;
  validacion: Validacion;
}

const MOTIVO_SIN_CONTRATO = "sin adjunto de contrato legible (RN4)";
const MOTIVO_COTIZACION = "el adjunto es una cotización, no un contrato (RN4)";

export async function buscarContrato(r: Rutas, mensajeId: string, correo: Correo): Promise<AdjuntoContrato | null> {
  for (const nombre of correo.adjuntos.filter((a) => a.toLowerCase().endsWith(".txt"))) {
    const texto = await leerTextoAdjunto(r, mensajeId, nombre);
    if (esContrato(texto)) return { nombre, texto };
  }
  return null;
}

// Si no hay contrato, distinguimos una cotización para que el motivo sea preciso.
async function motivoSinContrato(r: Rutas, mensajeId: string, correo: Correo): Promise<string> {
  for (const nombre of correo.adjuntos.filter((a) => a.toLowerCase().endsWith(".txt"))) {
    const texto = await leerTextoAdjunto(r, mensajeId, nombre);
    if (/COTIZACI[ÓO]N/i.test(texto)) return MOTIVO_COTIZACION;
  }
  return MOTIVO_SIN_CONTRATO;
}

export async function analizarMensaje(r: Rutas, mensajeId: string, hoy: string): Promise<Analisis> {
  const correo = await leerCorreo(r, mensajeId);
  const adjunto = await buscarContrato(r, mensajeId, correo);
  const contrato = adjunto ? extraerDeTexto(adjunto.texto, correo) : null;
  const validacion = clasificar({
    contrato,
    remitente: correo.de,
    maestro: await leerMaestro(r),
    comerciales: await leerComerciales(r),
    anioRef: hoy.slice(0, 4),
    motivoSinContrato: adjunto ? undefined : await motivoSinContrato(r, mensajeId, correo),
  });
  return { correo, adjunto, contrato, validacion };
}
