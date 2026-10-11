// Escritura en el maestro (copia de out/). Solo escribe si el contrato está limpio o la analista lo confirmó.
import path from "node:path";
import { analizarMensaje } from "./analizar";
import { camposARevisar, clasificar } from "./clasificar";
import {
  agregarHistorial, contarHistorial, copiarAdjunto, escribirMaestro, leerComerciales, leerMaestro,
  leerProcesados, marcarProcesado, registrarLog, type Rutas,
} from "./almacen";
import type { Contrato, FilaMaestro, Resultado, Validacion } from "./tipos";
import { slug } from "./utilidades";

export interface Correcciones {
  id_contrato?: string;
  cliente?: string;
  nit_cliente?: string;
  objeto?: string;
  valor?: number;
  moneda?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
}

export interface OpcionesRegistro {
  hoy: string;
  confirmado: boolean;
  correcciones?: Correcciones;
}

const fallo = (error: string, requiere?: string[], propuestos?: Record<string, unknown>): Resultado => ({
  ok: false,
  error,
  ...(requiere ? { requiere_confirmacion: requiere } : {}),
  ...(propuestos ? { valores_propuestos: propuestos } : {}),
});

export async function registrarMensaje(r: Rutas, mensajeId: string, op: OpcionesRegistro): Promise<Resultado> {
  const resultado = await procesar(r, mensajeId, op);
  await registrarLog(r, {
    herramienta: "registrar",
    mensaje_id: mensajeId,
    ok: resultado.ok,
    resumen: resultado.ok ? `${String(resultado.data.accion)} ${String(resultado.data.id_contrato ?? "")}`.trim() : resultado.error,
  });
  return resultado;
}

async function procesar(r: Rutas, mensajeId: string, op: OpcionesRegistro): Promise<Resultado> {
  if ((await leerProcesados(r)).includes(mensajeId)) return fallo(`${mensajeId} ya fue procesado`);
  if (op.correcciones && !op.confirmado) return fallo("las correcciones solo se aceptan con confirmado = true");

  const analisis = await analizarMensaje(r, mensajeId, op.hoy);
  let contrato: Contrato | null = analisis.contrato;
  let v: Validacion = analisis.validacion;
  if (contrato && (op.correcciones || op.confirmado)) {
    if (op.correcciones) contrato = aplicarCorrecciones(contrato, op.correcciones);
    if (op.confirmado) contrato = aceptarVisibles(contrato);
    v = clasificar({
      contrato,
      remitente: analisis.correo.de,
      maestro: await leerMaestro(r),
      comerciales: await leerComerciales(r),
      anioRef: op.hoy.slice(0, 4),
    });
  }

  if (v.clasificacion === "rechazado") {
    await marcarProcesado(r, mensajeId);
    return fallo(v.motivo ?? "rechazado");
  }
  if (v.clasificacion === "duplicado") {
    await marcarProcesado(r, mensajeId);
    return { ok: true, data: { id_contrato: v.id_resuelto, accion: "duplicado", ruta_archivo: null, motivo: v.motivo ?? null } };
  }
  if (!contrato || !analisis.adjunto) return fallo("sin contrato legible");
  if (v.requiere_revision.length > 0) {
    const propuestos = Object.fromEntries(
      v.requiere_revision.map((k) => [k, contrato.campos[k as keyof typeof contrato.campos]]),
    );
    return fallo(`requiere revisión: ${v.requiere_revision.join(", ")}`, v.requiere_revision, propuestos);
  }

  const maestro = await leerMaestro(r);
  const ext = path.extname(analisis.adjunto.nombre) || ".txt";
  return v.clasificacion === "nuevo"
    ? escribirNuevo(r, mensajeId, op, contrato, v, maestro, analisis.adjunto.nombre, ext)
    : escribirActualizacion(r, mensajeId, op, contrato, v, maestro, analisis.adjunto.nombre, ext);
}

async function escribirNuevo(
  r: Rutas, mensajeId: string, op: OpcionesRegistro, c: Contrato, v: Validacion,
  maestro: FilaMaestro[], adjunto: string, ext: string,
): Promise<Resultado> {
  const k = c.campos;
  const id = v.id_resuelto ?? "";
  const anio = (k.fecha_inicio ?? op.hoy).slice(0, 4);
  const ruta = `Contratos/${anio}/${slug(k.cliente ?? "")}/${id}${ext}`;
  const fila: FilaMaestro = {
    id_contrato: id,
    cliente: k.cliente ?? "",
    nit_cliente: k.nit_cliente ?? "",
    pais: k.pais ?? "",
    objeto: k.objeto ?? "",
    valor: k.valor ?? 0,
    moneda: k.moneda ?? "",
    fecha_inicio: k.fecha_inicio ?? "",
    fecha_fin: k.fecha_fin ?? "",
    requiere_poliza: k.requiere_poliza,
    tipo_poliza: k.tipo_poliza,
    estado_poliza: k.requiere_poliza ? "pendiente" : "no_aplica",
    comercial: v.comercial ?? "",
    ruta_sharepoint: ruta,
    fecha_registro: op.hoy,
    fuente: "buzon",
  };
  await copiarAdjunto(r, mensajeId, adjunto, ruta);
  await escribirMaestro(r, [...maestro, fila]);
  await agregarHistorial(r, {
    id_contrato: id, accion: "nuevo", cambios: {}, mensaje_id: mensajeId,
    poliza: k.poliza, confirmado_por_humano: op.confirmado,
  });
  await marcarProcesado(r, mensajeId);
  return { ok: true, data: { id_contrato: id, accion: "nuevo", ruta_archivo: ruta } };
}

async function escribirActualizacion(
  r: Rutas, mensajeId: string, op: OpcionesRegistro, c: Contrato, v: Validacion,
  maestro: FilaMaestro[], adjunto: string, ext: string,
): Promise<Resultado> {
  const id = v.id_resuelto ?? "";
  const fila = maestro.find((f) => f.id_contrato === id);
  if (!fila) return fallo("contrato a actualizar no encontrado en el maestro");

  const d = v.diferencias;
  if (d.valor) fila.valor = Number(d.valor.despues);
  if (d.moneda) fila.moneda = String(d.moneda.despues);
  if (d.fecha_inicio) fila.fecha_inicio = String(d.fecha_inicio.despues);
  if (d.fecha_fin) fila.fecha_fin = String(d.fecha_fin.despues);

  // Un otrosí se archiva junto al contrato base, numerado por contrato (RN2).
  const tipo = c.tipo === "otrosi" ? "otrosi" : "actualizacion";
  const n = (await contarHistorial(r, id, "actualizacion")) + 1;
  const ruta = `${path.posix.dirname(fila.ruta_sharepoint)}/${id}-${tipo}-${n}${ext}`;
  await copiarAdjunto(r, mensajeId, adjunto, ruta);
  await escribirMaestro(r, maestro);
  await agregarHistorial(r, {
    id_contrato: id, accion: "actualizacion", cambios: d, mensaje_id: mensajeId,
    archivo: ruta, confirmado_por_humano: op.confirmado,
  });
  await marcarProcesado(r, mensajeId);
  return { ok: true, data: { id_contrato: id, accion: "actualizacion", ruta_archivo: ruta } };
}

// Los valores que la analista escribió se marcan con confianza 1: son confirmados por una persona.
function aplicarCorrecciones(c: Contrato, cor: Correcciones): Contrato {
  const confianza = { ...c.confianza };
  for (const clave of Object.keys(cor)) confianza[clave] = 1;
  return {
    ...c,
    campos: {
      ...c.campos,
      ...cor,
      // Un valor 0 confirmado mantiene el carácter indeterminado; un monto real lo quita.
      valor_indeterminado: cor.valor !== undefined ? cor.valor === 0 && c.campos.valor_indeterminado : c.campos.valor_indeterminado,
    },
    confianza,
  };
}

// Con confirmado = true se aceptan los campos en revisión que sí tienen valor. Los nulos siguen exigiendo corrección.
function aceptarVisibles(c: Contrato): Contrato {
  const confianza = { ...c.confianza };
  for (const k of camposARevisar(c)) {
    if (c.campos[k] !== null) confianza[k] = 1;
  }
  return { ...c, confianza };
}
