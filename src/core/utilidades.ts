// Funciones puras: fechas, montos, texto, similitud y CSV. Sin efectos secundarios.

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const diasDelMes = (anio: number, mes: number): number =>
  new Date(Date.UTC(anio, mes, 0)).getUTCDate();

export function fechaIso(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// "primero (1) de agosto de 2026" -> el número entre paréntesis manda: (1), (31), (14)...
export function fechaEs(dia: string, mes: string, anio: string): string | null {
  const m = MESES[mes.toLowerCase()];
  return m ? fechaIso(Number(anio), m, Number(dia)) : null;
}

export function sumarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const total = m - 1 + meses;
  const anio = a + Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return fechaIso(anio, mes, Math.min(d, diasDelMes(anio, mes))) ?? iso;
}

export function restarDia(iso: string): string {
  return new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);
}

// "265.000.000" -> 265000000 ; "520,000.00" -> 520000 ; "180000" -> 180000
export function parseMonto(texto: string): number | null {
  const decimal = texto.match(/^(.*)[.,](\d{2})$/);
  const limpio = decimal
    ? `${decimal[1].replace(/[.,]/g, "")}.${decimal[2]}`
    : texto.replace(/[.,]/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// "890.900.111-4" -> "890900111"
export function nitLimpio(texto: string): string {
  return texto.split("-")[0].replace(/\D/g, "");
}

export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export const emailNorm = (email: string): string => email.trim().toLowerCase();

// Solo partículas que nunca inician un nombre propio ("Los Andes" conserva su mayúscula).
const PARTICULAS = new Set(["de", "del", "y", "e"]);

// "INDUSTRIAS DELTA S.A.S." -> "Industrias Delta S.A.S."
// "CORPORACIÓN ANDINA DE SERVICIOS S.A." -> "Corporación Andina de Servicios S.A."
export function tituloNombre(texto: string): string {
  return texto
    .trim()
    .split(/\s+/)
    .map((p, i) => {
      if (/^(?:[A-ZÁÉÍÓÚÑ]\.)+$/.test(p)) return p;
      const minuscula = p.toLowerCase();
      if (i > 0 && PARTICULAS.has(minuscula)) return minuscula;
      return p.charAt(0).toUpperCase() + minuscula.slice(1);
    })
    .join(" ");
}

// "Logística del Istmo S.A." -> "logistica-del-istmo" (sin sufijo societario)
export function slug(nombre: string): string {
  return normalizarTexto(nombre)
    .replace(/\bs\.\s?a\.\s?(?:[sc]\.)?$/, "")
    .replace(/\bs\.\s?de\s?r\.\s?l\.$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function bigramas(texto: string): string[] {
  const t = texto.replace(/[^a-z0-9]/g, "");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

// Coeficiente de Dice sobre bigramas: 1 = idéntico, 0 = nada en común.
export function similitud(a: string, b: string): number {
  const x = bigramas(normalizarTexto(a));
  const y = bigramas(normalizarTexto(b));
  if (x.length === 0 || y.length === 0) return 0;
  const cuenta = new Map<string, number>();
  for (const g of y) cuenta.set(g, (cuenta.get(g) ?? 0) + 1);
  let comunes = 0;
  for (const g of x) {
    const n = cuenta.get(g) ?? 0;
    if (n > 0) {
      comunes++;
      cuenta.set(g, n - 1);
    }
  }
  return (2 * comunes) / (x.length + y.length);
}

export function parseCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c !== ""));
}

export function escribirCsv(filas: string[][]): string {
  return (
    filas
      .map((f) => f.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n") + "\n"
  );
}
