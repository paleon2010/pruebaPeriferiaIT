// Verificación sin modelo (PRD §6.6): llama a las mismas herramientas que usa el chat.
// Limpia out/ al inicio para que la salida sea reproducible (salvo timestamps internos que no se imprimen).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inicializar, rutasDe } from "./src/core/almacen";
import { herramientas } from "./src/tools/contratos";

const raiz = path.dirname(fileURLToPath(import.meta.url));
const HOY = "2026-09-03";
const ctx = { directory: raiz, sessionId: "demo", hoy: HOY };

// Confirmaciones humanas. PRD §11 fija valor 0 y fecha fin 2027-08-31 para msg-006.
// La fecha de inicio no aparece en el contrato marco; se toma 2026-09-01, acordada con la analista.
const CONFIRMACIONES: Record<string, Record<string, unknown>> = {
  "msg-006": { valor: 0, fecha_inicio: "2026-09-01", fecha_fin: "2027-08-31" },
};

type Respuesta = {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
  requiere_confirmacion?: string[];
};

async function llamar(nombre: keyof typeof herramientas, entrada: unknown): Promise<Respuesta> {
  return JSON.parse(await herramientas[nombre].execute(entrada, ctx)) as Respuesta;
}

const contar = (d: Record<string, unknown> | undefined, clave: string): number =>
  Array.isArray(d?.[clave]) ? (d[clave] as unknown[]).length : 0;

async function main(): Promise<void> {
  await inicializar(rutasDe(raiz), { limpiar: true });

  const buzon = await llamar("leer_buzon", {});
  const mensajes = (buzon.data?.mensajes ?? []) as Array<{ id: string; asunto: string }>;
  console.log(`Buzón pendiente: ${mensajes.length} mensaje(s)`);

  for (const m of mensajes) {
    console.log(`\n== ${m.id} · ${m.asunto}`);
    const v = await llamar("validar", { mensaje_id: m.id });
    console.log(`   validación: ${JSON.stringify(v.data)}`);

    const r = await llamar("registrar", { mensaje_id: m.id });
    console.log(`   registro: ${r.ok ? JSON.stringify(r.data) : `NO → ${r.error}`}`);

    const confirmacion = CONFIRMACIONES[m.id];
    if (!r.ok && r.requiere_confirmacion?.length && confirmacion) {
      console.log(`   confirmación humana simulada: ${JSON.stringify(confirmacion)}`);
      const c = await llamar("registrar", { mensaje_id: m.id, confirmado: true, correcciones: confirmacion });
      console.log(`   registro confirmado: ${c.ok ? JSON.stringify(c.data) : `NO → ${c.error}`}`);
    }
  }

  const alertas = await llamar("alertas", { hoy: HOY });
  console.log(
    `\nAlertas → out/alertas.md (vencen: ${contar(alertas.data, "vencen")}, ` +
      `pólizas pendientes: ${contar(alertas.data, "polizas_pendientes")}, ` +
      `vencidos: ${contar(alertas.data, "vencidos")})`,
  );
}

main().catch((e: unknown) => {
  console.error("Error en demo:", e instanceof Error ? e.message : e);
  process.exit(1);
});
