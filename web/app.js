// Front de chat sin framework. Todo el contenido se escribe con textContent para evitar inyección HTML.
const idSesion = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const chat = document.querySelector("#chat");
const formulario = document.querySelector("#formulario");
const entrada = document.querySelector("#entrada");
const boton = document.querySelector("#enviar");
const estado = document.querySelector("#estado");
let clave = sessionStorage.getItem("clave") || "";

function burbuja(rol, texto) {
  const div = document.createElement("div");
  div.className = `burbuja ${rol}`;
  div.textContent = texto;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function mostrarLlamada(l) {
  const d = document.createElement("details");
  d.className = `llamada ${l.ok ? "" : "fallo"}`;
  const s = document.createElement("summary");
  s.textContent = `Herramienta ${l.nombre} · ${l.ok ? "ok" : "error"} · ${l.resumen}`;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(l.entrada, null, 2);
  d.append(s, pre);
  chat.appendChild(d);
}

function mostrarConfirmacion() {
  const caja = document.createElement("div");
  caja.className = "confirmacion";
  const texto = document.createElement("span");
  const fuerte = document.createElement("strong");
  fuerte.textContent = "Confirmación requerida. ";
  texto.append(fuerte, "El agente no registrará los campos en revisión hasta que confirmes.");
  const ok = document.createElement("button");
  ok.textContent = "Confirmar";
  ok.addEventListener("click", () => {
    caja.remove();
    enviar("confirmo");
  });
  caja.append(texto, ok);
  chat.appendChild(caja);
  chat.scrollTop = chat.scrollHeight;
}

function pedirClave() {
  const valor = prompt("Clave de acceso");
  if (valor) {
    clave = valor;
    sessionStorage.setItem("clave", valor);
  }
}

async function enviar(texto) {
  burbuja("usuario", texto);
  const pensando = burbuja("asistente", "Pensando…");
  pensando.classList.add("pensando");
  boton.disabled = true;
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(clave ? { authorization: `Bearer ${clave}` } : {}),
      },
      body: JSON.stringify({ sessionId: idSesion, message: texto }),
    });
    const datos = await r.json();
    pensando.remove();
    if (!r.ok) {
      if (r.status === 401) {
        clave = "";
        sessionStorage.removeItem("clave");
        pedirClave();
      }
      burbuja("error", datos.error || "Error desconocido.");
      return;
    }
    datos.toolCalls.forEach(mostrarLlamada);
    burbuja("asistente", datos.reply);
    if (datos.needsConfirmation) mostrarConfirmacion();
  } catch {
    pensando.remove();
    burbuja("error", "No se pudo contactar el servidor.");
  } finally {
    boton.disabled = false;
  }
}

formulario.addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = entrada.value.trim();
  if (!texto) return;
  entrada.value = "";
  enviar(texto);
});

entrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formulario.requestSubmit();
  }
});

async function iniciar() {
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    estado.textContent = d.configurado ? `Modelo: ${d.modelo}` : "Modelo no configurado en el servidor";
    if (d.requiereClave && !clave) pedirClave();
  } catch {
    estado.textContent = "Servidor no disponible";
  }
}
iniciar();
