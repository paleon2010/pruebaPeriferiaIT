import { beforeAll, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inicializar, rutasDe } from "../src/core/almacen";
import { analizarMensaje } from "../src/core/analizar";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = rutasDe(raiz);

beforeAll(async () => {
  await inicializar(r, { limpiar: true });
});

test("msg-001 es un contrato nuevo sin campos en revisión", async () => {
  const a = await analizarMensaje(r, "msg-001", "2026-09-03");
  expect(a.validacion.clasificacion).toBe("nuevo");
  expect(a.validacion.id_resuelto).toBe("CT-2026-015");
  expect(a.validacion.requiere_revision).toEqual([]);
});

test("msg-003 es una actualización de CT-2026-011 (valor y fecha fin)", async () => {
  const a = await analizarMensaje(r, "msg-003", "2026-09-03");
  expect(a.validacion.clasificacion).toBe("actualizacion");
  expect(a.validacion.id_resuelto).toBe("CT-2026-011");
  expect(Object.keys(a.validacion.diferencias).sort()).toEqual(["fecha_fin", "valor"]);
});

test("msg-004 es un reenvío duplicado de CT-2026-012", async () => {
  const a = await analizarMensaje(r, "msg-004", "2026-09-03");
  expect(a.validacion.clasificacion).toBe("duplicado");
  expect(a.validacion.id_resuelto).toBe("CT-2026-012");
});

test("msg-005 es una cotización: rechazado y sin contrato extraído", async () => {
  const a = await analizarMensaje(r, "msg-005", "2026-09-03");
  expect(a.contrato).toBeNull();
  expect(a.validacion.clasificacion).toBe("rechazado");
  expect(a.validacion.id_resuelto).toBeNull();
});

test("msg-006 es un contrato marco nuevo: sin valor, sin póliza propia, con revisión", async () => {
  const a = await analizarMensaje(r, "msg-006", "2026-09-03");
  expect(a.contrato?.tipo).toBe("marco");
  expect(a.validacion.clasificacion).toBe("nuevo");
  expect(a.validacion.id_resuelto).toBe("CM-2026-03");
  expect(a.validacion.requiere_revision.sort()).toEqual(["fecha_fin", "fecha_inicio", "valor"]);
  expect(a.contrato?.campos.requiere_poliza).toBe(false);
  expect(a.contrato?.campos.valor_indeterminado).toBe(true);
  expect(a.validacion.avisos.some((x) => x.includes("jperez"))).toBe(true);
});

test("msg-005 indica que el adjunto es una cotización", async () => {
  const a = await analizarMensaje(r, "msg-005", "2026-09-03");
  expect(a.validacion.motivo).toContain("cotización");
});
