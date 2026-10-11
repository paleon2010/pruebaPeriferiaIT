// Única capa que toca el disco. Fixtures: solo lectura. out/: escritura.
import { access, appendFile, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { COLUMNAS_MAESTRO, type Comercial, type Correo, type FilaMaestro } from "./tipos";
import { emailNorm, escribirCsv, parseCsv } from "./utilidades";

export interface Rutas {
  raiz: string;
  buzon: string;
  comerciales: string;
  maestroFixture: string;
  out: string;
  sharepoint: string;
  maestro: string;
  historial: string;
  procesados: string;
  log: string;
  alertas: string;
}

export function rutasDe(raiz: string): Rutas {
  const fixtures = path.join(raiz, "fixtures", "reto-02");
  const out = path.join(raiz, "out");
  const sharepoint = path.join(out, "sharepoint");
  return {
    raiz,
    buzon: path.join(fixtures, "buzon"),
    comerciales: path.join(fixtures, "comerciales.json"),
    maestroFixture: path.join(fixtures, "maestro-contratos.csv"),
    out,
    sharepoint,
    maestro: path.join(sharepoint, "maestro-contratos.csv"),
    historial: path.join(sharepoint, "historial.jsonl"),
    procesados: path.join(out, "procesados.json"),
    log: path.join(out, "log.jsonl"),
    alertas: path.join(out, "alertas.md"),
  };
}

async function existe(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// RN6: el maestro del fixture se copia una sola vez; las escrituras van a la copia.
export async function inicializar(r: Rutas, opciones: { limpiar: boolean }): Promise<void> {
  if (opciones.limpiar) await rm(r.out, { recursive: true, force: true });
  await mkdir(r.sharepoint, { recursive: true });
  if (!(await existe(r.maestro))) await copyFile(r.maestroFixture, r.maestro);
  if (!(await existe(r.historial))) await writeFile(r.historial, "");
  if (!(await existe(r.procesados))) await writeFile(r.procesados, "[]\n");
}

function filaDesde(o: Record<string, string>): FilaMaestro {
  return {
    id_contrato: o.id_contrato,
    cliente: o.cliente,
    nit_cliente: o.nit_cliente,
    pais: o.pais,
    objeto: o.objeto,
    valor: Number(o.valor),
    moneda: o.moneda,
    fecha_inicio: o.fecha_inicio,
    fecha_fin: o.fecha_fin,
    requiere_poliza: o.requiere_poliza === "true",
    tipo_poliza: o.tipo_poliza,
    estado_poliza: o.estado_poliza,
    comercial: o.comercial,
    ruta_sharepoint: o.ruta_sharepoint,
    fecha_registro: o.fecha_registro,
    fuente: o.fuente,
  };
}

export async function leerMaestro(r: Rutas): Promise<FilaMaestro[]> {
  const [cabecera = [], ...filas] = parseCsv(await readFile(r.maestro, "utf8"));
  return filas.map((f) => filaDesde(Object.fromEntries(cabecera.map((c, i) => [c, f[i] ?? ""]))));
}

export async function escribirMaestro(r: Rutas, filas: FilaMaestro[]): Promise<void> {
  const cuerpo = filas.map((f) => COLUMNAS_MAESTRO.map((c) => String(f[c])));
  await writeFile(r.maestro, escribirCsv([[...COLUMNAS_MAESTRO], ...cuerpo]));
}

const esquemaComerciales = z.array(
  z.object({ email: z.email(), nombre: z.string().min(1), region: z.string().min(1) }),
);

export async function leerComerciales(r: Rutas): Promise<Comercial[]> {
  const datos = esquemaComerciales.parse(JSON.parse(await readFile(r.comerciales, "utf8")));
  const emails = datos.map((c) => emailNorm(c.email));
  if (new Set(emails).size !== emails.length) throw new Error("comerciales.json tiene emails duplicados");
  return datos;
}

const esquemaIds = z.array(z.string());

export async function leerProcesados(r: Rutas): Promise<string[]> {
  return esquemaIds.parse(JSON.parse(await readFile(r.procesados, "utf8")));
}

export async function marcarProcesado(r: Rutas, id: string): Promise<void> {
  const ids = await leerProcesados(r);
  if (!ids.includes(id)) ids.push(id);
  await writeFile(r.procesados, `${JSON.stringify(ids, null, 2)}\n`);
}

export async function agregarHistorial(r: Rutas, entrada: Record<string, unknown>): Promise<void> {
  await appendFile(r.historial, `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`);
}

export async function contarHistorial(r: Rutas, idContrato: string, accion: string): Promise<number> {
  const lineas = (await readFile(r.historial, "utf8")).split("\n").filter(Boolean);
  return lineas
    .map((l) => JSON.parse(l) as { id_contrato: string; accion: string })
    .filter((e) => e.id_contrato === idContrato && e.accion === accion).length;
}

// RN7: cada ejecución deja una línea en out/log.jsonl.
export async function registrarLog(
  r: Rutas,
  entrada: { herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string },
): Promise<void> {
  await appendFile(r.log, `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`);
}

export async function escribirAlertas(r: Rutas, markdown: string): Promise<void> {
  await writeFile(r.alertas, markdown);
}

const esquemaCorreo = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
});

export async function listarMensajes(r: Rutas): Promise<string[]> {
  const entradas = await readdir(r.buzon, { withFileTypes: true });
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export async function leerCorreo(r: Rutas, mensajeId: string): Promise<Correo> {
  return esquemaCorreo.parse(JSON.parse(await readFile(path.join(r.buzon, mensajeId, "correo.json"), "utf8")));
}

export async function leerTextoAdjunto(r: Rutas, mensajeId: string, nombre: string): Promise<string> {
  return readFile(path.join(r.buzon, mensajeId, path.basename(nombre)), "utf8");
}

export async function copiarAdjunto(r: Rutas, mensajeId: string, nombre: string, destino: string): Promise<void> {
  const ruta = path.join(r.sharepoint, destino);
  await mkdir(path.dirname(ruta), { recursive: true });
  await copyFile(path.join(r.buzon, mensajeId, path.basename(nombre)), ruta);
}
