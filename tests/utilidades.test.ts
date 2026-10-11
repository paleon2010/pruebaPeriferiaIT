import { expect, test } from "bun:test";
import { nitLimpio, parseMonto, similitud, slug, sumarMeses, tituloNombre } from "../src/core/utilidades";

test("montos en formato colombiano y anglosajón", () => {
  expect(parseMonto("265.000.000")).toBe(265000000);
  expect(parseMonto("520,000.00")).toBe(520000);
  expect(parseMonto("180000")).toBe(180000);
});

test("NIT sin dígito de verificación ni puntos", () => {
  expect(nitLimpio("890.900.111-4")).toBe("890900111");
});

test("suma de meses con fin de mes", () => {
  expect(sumarMeses("2027-07-31", 4)).toBe("2027-11-30");
});

test("nombre de cliente en forma societaria", () => {
  expect(tituloNombre("INDUSTRIAS DELTA S.A.S.")).toBe("Industrias Delta S.A.S.");
});

test("slug sin sufijo societario", () => {
  expect(slug("Logística del Istmo S.A.")).toBe("logistica-del-istmo");
  expect(slug("Agropesa")).toBe("agropesa");
});

test("similitud de objetos", () => {
  expect(similitud("abc", "abc")).toBe(1);
  expect(similitud("Soporte SAP", "Desarrollo de portal B2B")).toBeLessThan(0.9);
});

test("partículas en minúscula dentro del nombre", () => {
  expect(tituloNombre("CORPORACIÓN ANDINA DE SERVICIOS S.A.")).toBe("Corporación Andina de Servicios S.A.");
  expect(tituloNombre("MINERA LOS ANDES S.A.C.")).toBe("Minera Los Andes S.A.C.");
});
