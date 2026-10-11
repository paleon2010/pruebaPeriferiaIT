// Única capa que accede a datos. Los fixtures se leen del proyecto; el estado se guarda en out/.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { COLUMNAS_MAESTRO, type Comercial, type Correo, type FilaMaestro } from "./tipos";
import { emailNorm, escribirCsv, parseCsv } from "./utilidades";

export interface Almacen {
  leer(clave: string): Promise<string | null>;
  escribir(clave: string, valor: string): Promise<void>;
  limpiar(): Promise<void>;
}

class AlmacenFs implements Almacen {
  constructor(private readonly base: string) {}

  private ruta(clave: string): string {
    return path.join(this.base, clave);
  }

  async leer(clave: string): Promise<string | null> {
    try {
      return await readFile(this.ruta(clave), "utf8");
    } catch {
      return null;
    }
  }

  async escribir(clave: string, valor: string): Promise<void> {
    await mkdir(path.dirname(this.ruta(clave)), { recursive: true });
    await writeFile(this.ruta(clave), valor);
  }

  async limpiar(): Promise<void> {
    await rm(this.base, { recursive: true, force: true });
  }
}

// Claves del estado persistido dentro de out/.
export const claves = {
  maestro: "sharepoint/maestro-contratos.csv",
  historial: "sharepoint/historial.jsonl",
  procesados: "procesados.json",
  log: "log.jsonl",
  alertas: "alertas.md",
  presupuesto: "presupuesto.json",
  sesion: (id: string): string => `sesiones/${id}.json`,
  adjunto: (ruta: string): string => `sharepoint/${ruta}`,
};

export interface Rutas {
  raiz: string;
  buzon: string;
  comerciales: string;
  maestroFixture: string;
  store: Almacen;
}

export function rutasDe(raiz: string): Rutas {
  const fixtures = path.join(raiz, "fixtures", "reto-02");
  const store: Almacen = new AlmacenFs(path.join(raiz, "out"));
  return {
    raiz,
    buzon: path.join(fixtures, "buzon"),
    comerciales: path.join(fixtures, "comerciales.json"),
    maestroFixture: path.join(fixtures, "maestro-contratos.csv"),
    store,
  };
}

// RN6: el maestro del fixture se copia una sola vez; las escrituras van a la copia.
export async function inicializar(r: Rutas, opciones: { limpiar: boolean }): Promise<void> {
  if (opciones.limpiar) await r.store.limpiar();
  if ((await r.store.leer(claves.maestro)) === null) {
    await r.store.escribir(claves.maestro, await readFile(r.maestroFixture, "utf8"));
  }
  if ((await r.store.leer(claves.historial)) === null) await r.store.escribir(claves.historial, "");
  if ((await r.store.leer(claves.procesados)) === null) await r.store.escribir(claves.procesados, "[]\n");
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
  const texto = await r.store.leer(claves.maestro);
  if (texto === null) throw new Error("el maestro no está inicializado");
  const [cabecera = [], ...filas] = parseCsv(texto);
  return filas.map((f) => filaDesde(Object.fromEntries(cabecera.map((c, i) => [c, f[i] ?? ""]))));
}

export async function escribirMaestro(r: Rutas, filas: FilaMaestro[]): Promise<void> {
  const cuerpo = filas.map((f) => COLUMNAS_MAESTRO.map((c) => String(f[c])));
  await r.store.escribir(claves.maestro, escribirCsv([[...COLUMNAS_MAESTRO], ...cuerpo]));
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
  return esquemaIds.parse(JSON.parse((await r.store.leer(claves.procesados)) ?? "[]"));
}

export async function marcarProcesado(r: Rutas, id: string): Promise<void> {
  const ids = await leerProcesados(r);
  if (!ids.includes(id)) ids.push(id);
  await r.store.escribir(claves.procesados, `${JSON.stringify(ids, null, 2)}\n`);
}

async function agregarLinea(r: Rutas, clave: string, linea: string): Promise<void> {
  const previo = (await r.store.leer(clave)) ?? "";
  await r.store.escribir(clave, `${previo}${linea}\n`);
}

export async function agregarHistorial(r: Rutas, entrada: Record<string, unknown>): Promise<void> {
  await agregarLinea(r, claves.historial, JSON.stringify({ ts: new Date().toISOString(), ...entrada }));
}

export async function contarHistorial(r: Rutas, idContrato: string, accion: string): Promise<number> {
  const lineas = ((await r.store.leer(claves.historial)) ?? "").split("\n").filter(Boolean);
  return lineas
    .map((l) => JSON.parse(l) as { id_contrato: string; accion: string })
    .filter((e) => e.id_contrato === idContrato && e.accion === accion).length;
}

// RN7: cada ejecución deja una línea en el log.
export async function registrarLog(
  r: Rutas,
  entrada: { herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string },
): Promise<void> {
  await agregarLinea(r, claves.log, JSON.stringify({ ts: new Date().toISOString(), ...entrada }));
}

export async function escribirAlertas(r: Rutas, markdown: string): Promise<void> {
  await r.store.escribir(claves.alertas, markdown);
}

export async function leerTokensGlobales(r: Rutas): Promise<number> {
  const texto = await r.store.leer(claves.presupuesto);
  return texto ? (JSON.parse(texto) as { tokens: number }).tokens : 0;
}

export async function sumarTokensGlobales(r: Rutas, tokens: number): Promise<void> {
  const actual = await leerTokensGlobales(r);
  await r.store.escribir(claves.presupuesto, JSON.stringify({ tokens: actual + tokens }));
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

// Los mensajes del buzón son fixtures del proyecto (solo lectura).
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
  const texto = await leerTextoAdjunto(r, mensajeId, nombre);
  await r.store.escribir(claves.adjunto(destino), texto);
}
