(() => {
'use strict';

/* =====================================================================
   Utilidades
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const miles = n => String(Math.abs(Math.round(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const clp = n => (n < 0 ? '-$ ' : '$ ') + miles(n);
const num = v => parseInt(String(v ?? '').replace(/\D/g, ''), 10) || 0;
const dec = v => parseFloat(String(v ?? '').replace(',', '.')) || 0;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => iso(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDias = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const fecha = s => (s ? s.split('-').reverse().join('/') : '');
const clone = o => JSON.parse(JSON.stringify(o));
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_C = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MARCAS = ['Toyota', 'Chevrolet', 'Hyundai', 'Kia', 'Nissan', 'Suzuki', 'Mazda', 'Peugeot', 'Ford', 'Volkswagen', 'Renault', 'Mitsubishi', 'Honda', 'Subaru', 'Citroën', 'Fiat', 'Chery', 'MG', 'Great Wall', 'Haval', 'JAC', 'Changan', 'SsangYong', 'Jeep', 'Dodge', 'Opel', 'Skoda', 'Seat', 'Volvo', 'BMW', 'Mercedes-Benz', 'Audi', 'Lifan', 'Daihatsu', 'Isuzu', 'Mini'];

const lunes = d => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); return r; };
const corto = v => (v >= 1e6 ? '$' + (v / 1e6).toFixed(1).replace('.', ',') + ' M' : v >= 1000 ? '$' + Math.round(v / 1000) + ' mil' : '$' + v);

// Estados del auto (el «presupuesto» ya no es un estado de auto: vive solo en Presupuestos)
const ESTADOS = { pendiente: 'Pendiente', finalizado: 'Finalizado' };
const ESTADOS_PRES = { espera: 'En espera', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const IVA = 0.19;

/* =====================================================================
   Datos y guardado
   ===================================================================== */
const TALLER_DEF = {
  nombre: 'El Garage de Einstein',
  direccion: 'Av. Einstein, Recoleta',
  telefono: '',
  mecanico: '',
  email: '',
  validez: 15,
  apiKey: '', // clave para autocompletar el auto por su patente (Boostr.cl)
  pie: 'Los valores pueden variar si al desarmar se detectan fallas adicionales. Se avisará antes de realizar cualquier trabajo extra.',
  // Texto del art. 42 de la Ley 19.496. Es editable en «Datos del taller» (conviene que lo revise un abogado).
  aviso42: 'AVISO LEGAL (art. 42, Ley N° 19.496): Se entenderán abandonadas en favor del proveedor las especies que le sean entregadas en reparación, cuando no sean retiradas en el plazo de un año contado desde la fecha en que se haya otorgado y suscrito el correspondiente documento de recepción del trabajo.'
};
const MESES_ALERTA = 10; // meses en el taller a partir de los cuales se avisa
// Interruptor de las funciones de orden de recepción, carta de aviso, alerta de abandono y aviso del art. 42.
// Está apagado: ponerlo en true las vuelve a activar (hay que recompilar el .exe).
const FUNCIONES_LEGALES = false;
const LS_KEY = 'garage-einstein-datos';
let db, bloqueado = false, recuperado = false, migrado = false;
const API = () => (window.pywebview && window.pywebview.api) || null;

// La API de la ventana está lista solo cuando ya tiene sus funciones (el objeto puede existir antes, vacío).
const apiLista = () => { const a = API(); return a && typeof a.cargar === 'function' && typeof a.guardar === 'function' ? a : null; };

function esperarApi() {
  return new Promise((res, rej) => {
    if (apiLista()) return res(apiLista());
    let t = 0, enApp = !!window.pywebview || location.protocol === 'file:';
    const iv = setInterval(() => {
      t += 100;
      if (apiLista()) { clearInterval(iv); return res(apiLista()); }
      if (window.pywebview) enApp = true;
      // En un navegador común (sin la ventana del programa) se usa el almacenamiento del navegador.
      if (!enApp && t >= 1500) { clearInterval(iv); return res(null); }
      // Dentro del programa NUNCA se arranca vacío: si la API no responde, se avisa y no se guarda nada.
      if (t >= 30000) { clearInterval(iv); rej(new Error('La API del programa no respondió')); }
    }, 100);
  });
}

function normalizar(d) {
  d = d && typeof d === 'object' ? d : {};
  const out = {
    version: 1,
    taller: { ...TALLER_DEF, ...(d.taller || {}) },
    autos: Array.isArray(d.autos) ? d.autos : [],
    presupuestos: Array.isArray(d.presupuestos) ? d.presupuestos : [],
    contador: Number(d.contador) > 0 ? Number(d.contador) : 1,
    borrador: d.borrador && d.borrador.draft ? d.borrador : null // formulario que quedó a medio llenar
  };
  out.autos.forEach(a => { a.pagos = Array.isArray(a.pagos) ? a.pagos : []; a.total = Number(a.total) || 0; });
  // Migración: los autos que estaban en estado «presupuesto» pasan a «pendiente» (no se borra nada).
  out.autos.forEach(a => { if (a.estado !== 'finalizado') a.estado = 'pendiente'; });
  const idsAutos = new Set(out.autos.map(a => a.id));
  out.presupuestos.forEach(p => {
    p.items = Array.isArray(p.items) ? p.items : [];
    if (!ESTADOS_PRES[p.estado]) p.estado = p.autoId && idsAutos.has(p.autoId) ? 'aprobado' : 'espera';
  });
  out.contador = Math.max(out.contador, ...out.presupuestos.map(p => (p.numero || 0) + 1), 1);
  // Todo auto entra por un presupuesto: los autos cargados directo reciben uno (aprobado) con su trabajo y total.
  out.autos.forEach(a => {
    const existente = out.presupuestos.find(p => p.id === a.presupuestoId) || out.presupuestos.find(p => p.autoId === a.id);
    if (existente) { a.presupuestoId = existente.id; return; }
    const id = uid();
    out.presupuestos.push({
      id, numero: out.contador++, estado: 'aprobado', fecha: a.ingreso || hoy(), validez: out.taller.validez || 15,
      cliente: a.cliente || '', telefono: a.telefono || '', patente: a.patente || '', marca: a.marca || '', modelo: a.modelo || '', anio: a.anio || '',
      items: [{ desc: (a.trabajo || '').trim() || 'Trabajo en el vehículo', cant: '1', precio: a.total || 0 }],
      iva: false, notas: '', autoId: a.id
    });
    a.presupuestoId = id;
    migrado = true;
  });
  return out;
}

async function cargar() {
  let raw = null, api = null, leido = false;
  try { api = await esperarApi(); } catch (e) { bloqueado = true; db = normalizar(null); return; }
  // Un error al leer NO es lo mismo que «no hay datos todavía»: se reintenta y, si no se puede, se bloquea el guardado.
  for (let i = 0; i < 5 && !leido; i++) {
    try { raw = api ? await api.cargar() : localStorage.getItem(LS_KEY); leido = true; }
    catch (e) { await new Promise(r => setTimeout(r, 600)); }
  }
  if (!leido) { bloqueado = true; db = normalizar(null); return; }
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) {
    // El archivo existe pero está dañado: NO arrancar vacío (el próximo guardado lo pisaría).
    let rescate = null;
    try { rescate = api ? await api.ultimo_respaldo() : null; rescate = rescate ? JSON.parse(rescate) : null; } catch (e2) { rescate = null; }
    if (!rescate) { bloqueado = true; db = normalizar(null); return; }
    data = rescate;
    recuperado = true;
  }
  db = normalizar(data);
}

// Los guardados se hacen de a uno, en orden; así el último que se escribe siempre tiene los datos más nuevos.
let colaGuardado = Promise.resolve();
function guardar() {
  const p = colaGuardado.then(escribirDatos, escribirDatos);
  colaGuardado = p.catch(() => {});
  return p;
}

async function escribirDatos() {
  if (bloqueado) { toast('Los datos no se pudieron leer. Para no perder nada, no se está guardando.', true); return false; }
  const json = JSON.stringify(db);
  const api = API();
  try {
    if (api) {
      const r = await api.guardar(json);
      if (r && r.ok === false) throw new Error(r.error);
    } else {
      localStorage.setItem(LS_KEY, json);
    }
    return true;
  } catch (e) {
    toast('No se pudo guardar: ' + (e.message || e), true);
    return false;
  }
}

/* ---- cálculos ---- */
const pagado = a => (a.pagos || []).reduce((s, p) => s + p.monto, 0);
const saldo = a => (a.total || 0) - pagado(a);
const subItem = it => Math.round(dec(it.cant) * (it.precio || 0));
const totalPres = p => {
  const sub = p.items.reduce((s, it) => s + subItem(it), 0);
  const iva = p.iva ? Math.round(sub * IVA) : 0;
  return { sub, iva, total: sub + iva };
};
const todosPagos = () => db.autos.flatMap(a => a.pagos.map(p => ({ ...p, a })));

/* ---- plazo del art. 42: 1 año desde la orden de recepción firmada (si no hay, desde el ingreso) ---- */
const baseFecha = a => a.recepcionFirmada || a.ingreso || hoy();
const mesesDesde = s => {
  const d = parseISO(s), n = new Date();
  let m = (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth();
  if (n.getDate() < d.getDate()) m--;
  return Math.max(0, m);
};
const venceFecha = a => { const d = parseISO(baseFecha(a)); return iso(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())); };
const mesesEnTaller = a => mesesDesde(baseFecha(a));
const enAlerta = a => FUNCIONES_LEGALES && !a.retirado && mesesEnTaller(a) >= MESES_ALERTA;
const textoTiempo = m => (m >= 12 ? `${Math.floor(m / 12)} año${m >= 24 ? 's' : ''}${m % 12 ? ' y ' + (m % 12) + ' mes' + (m % 12 > 1 ? 'es' : '') : ''}` : `${m} meses`);

/* =====================================================================
   Avisos y diálogos
   ===================================================================== */
let toastT;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = error ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, error ? 5000 : 3200);
}

function confirmar({ titulo, texto, ok = 'Aceptar', cancelar = 'Cancelar', peligro = false, enfocarOk = false }) {
  return new Promise(res => {
    const d = $('#dialog');
    $('.dlg', d).innerHTML = `
      <h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      <div class="acciones">
        <button class="btn" data-r="0">${esc(cancelar)}</button>
        <button class="btn ${peligro ? 'danger fill' : 'primary'}" data-r="1">${esc(ok)}</button>
      </div>`;
    d.hidden = false;
    const fin = v => { d.hidden = true; d.onclick = null; res(v); };
    d.onclick = e => { const b = e.target.closest('[data-r]'); if (b) fin(b.dataset.r === '1'); };
    $(enfocarOk ? '[data-r="1"]' : '[data-r="0"]', d).focus();
  });
}

/* =====================================================================
   Ventana emergente (formularios)
   ===================================================================== */
let ctx = null; // { tipo: 'auto' | 'pres', draft, dirty }

function mostrarModal(html, conservarScroll = false) {
  const m = $('#modal'), sh = $('.sheet', m);
  const sc = conservarScroll ? sh.scrollTop : 0;
  sh.innerHTML = html;
  m.hidden = false;
  document.body.classList.add('noscroll');
  sh.scrollTop = sc;
}

/* ---- borrador: lo que se va escribiendo en un formulario se guarda solo, para no perderlo si se cierra el programa ---- */
let borradorT;
function programarBorrador() {
  clearTimeout(borradorT);
  borradorT = setTimeout(async () => {
    if (!ctx || !ctx.dirty || bloqueado) return;
    db.borrador = { tipo: ctx.tipo, origen: ctx.origen || null, draft: clone(ctx.draft) };
    await guardar();
  }, 400);
}

async function cerrarModal(forzar = false) {
  if (!forzar && ctx && ctx.dirty) {
    const ok = await confirmar({
      titulo: '¿Salir sin guardar?',
      texto: 'Hiciste cambios que todavía no guardaste. Si sales ahora se pierden.',
      ok: 'Salir sin guardar', cancelar: 'Seguir editando', peligro: true
    });
    if (!ok) return;
  }
  clearTimeout(borradorT);
  if (db.borrador) { db.borrador = null; guardar(); }
  ctx = null;
  $('#modal').hidden = true;
  $('#modal .sheet').scrollTop = 0;
  document.body.classList.remove('noscroll');
}

/* ---- campos con formato de dinero ---- */
function formatearDinero(el) {
  const desdeFin = el.value.length - (el.selectionStart ?? el.value.length);
  const d = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  el.value = d ? miles(d) : '';
  const pos = Math.max(0, el.value.length - desdeFin);
  try { el.setSelectionRange(pos, pos); } catch (e) { /* ignorar */ }
}

/* =====================================================================
   Autocompletar el auto con la patente (marca, modelo y año)
   Si no se encuentra, o no hay internet, los datos se escriben a mano.
   ===================================================================== */
let patT, patSeq = 0, patUltima = '';
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tituloCase = s => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function marcaBonita(m) {
  const k = sinTildes(m);
  return MARCAS.find(x => sinTildes(x) === k) || tituloCase(m);
}
const modeloBonito = m => (/\d/.test(m) ? String(m).toUpperCase() : tituloCase(m));

function patLinea() {
  const e = ui.patEstado;
  return `<div class="pat-linea"><button type="button" class="btn small" data-act="buscarPatente">🔎 Buscar datos del auto</button><span id="patEstado" class="pat-estado ${e ? e.cls : ''}">${e ? esc(e.txt) : 'Al escribir la patente se rellenan marca, modelo y año. Si no aparecen, escríbelos tú.'}</span></div>`;
}
function estadoPat(txt, cls = '') {
  ui.patEstado = txt ? { txt, cls } : null;
  const el = $('#patEstado');
  if (el) { el.textContent = txt || 'Al escribir la patente se rellenan marca, modelo y año. Si no aparecen, escríbelos tú.'; el.className = 'pat-estado ' + (txt ? cls : ''); }
}
function reiniciarPatente() { clearTimeout(patT); patSeq++; patUltima = ''; ui.patEstado = null; }

function datosLocalPatente(pat) {
  const yo = ctx && ctx.draft.id;
  const fuentes = [...db.autos, ...db.presupuestos].filter(x => x.id !== yo && (x.patente || '').toUpperCase() === pat && (x.marca || '').trim());
  return fuentes.length ? fuentes[fuentes.length - 1] : null;
}

async function consultarPatente(pat, clave) {
  const api = API();
  if (api && typeof api.consultar_patente === 'function') return api.consultar_patente(pat, clave);
  try { // en un navegador común (solo para probar)
    const r = await fetch(`https://api.boostr.cl/vehicle/${pat}.json`, { headers: { 'X-API-KEY': clave, accept: 'application/json' } });
    if (!r.ok) return { ok: false, motivo: { 401: 'clave', 403: 'clave', 404: 'no_encontrada', 429: 'limite' }[r.status] || 'error' };
    const j = await r.json(), d = j.data || j;
    return d.make || d.model || d.year ? { ok: true, marca: d.make || '', modelo: d.model || '', anio: String(d.year || '') } : { ok: false, motivo: 'no_encontrada' };
  } catch (e) { return { ok: false, motivo: 'red' }; }
}

function aplicarVehiculo(v, sobrescribir) {
  const d = ctx.draft;
  const poner = (campo, valor) => {
    if (!valor) return;
    if (!sobrescribir && d[campo] && !ctx.autoFill) return; // lo que escribió la persona no se pisa
    d[campo] = valor;
    const el = $(`[data-f="${campo}"]`);
    if (el) el.value = valor;
  };
  poner('marca', v.marca); poner('modelo', v.modelo);
  poner('anio', /^\d{4}$/.test(String(v.anio || '').trim()) ? String(v.anio).trim() : '');
  ctx.autoFill = true;
  ctx.dirty = true;
  programarBorrador();
}

async function buscarPatente(forzar = false) {
  if (!ctx || (ctx.tipo !== 'auto' && ctx.tipo !== 'pres')) return;
  const pat = (ctx.draft.patente || '').trim().toUpperCase();
  if (pat.length < 5) { if (forzar) { estadoPat('Escribe la patente completa para buscarla', 'err'); $('[data-f="patente"]')?.focus(); } return; }
  if (!forzar && pat === patUltima) return;
  patUltima = pat;
  const mi = ++patSeq;
  if (!datosLocalPatente(pat) && (db.taller.apiKey || '').trim()) estadoPat('Buscando la patente…', 'busca');
  const r = await resolverPatente(pat);
  if (mi !== patSeq || !ctx || (ctx.draft.patente || '').trim().toUpperCase() !== pat) return; // cambió la patente mientras se buscaba
  if (r.datos) aplicarVehiculo(r.datos, forzar); else patUltima = ''; // sin datos: permite volver a intentar
  estadoPat(r.txt, r.cls);
}

// Busca marca, modelo y año de una patente: primero en lo ya ingresado, luego en internet. Nunca lanza error.
async function resolverPatente(pat) {
  const local = datosLocalPatente(pat);
  if (local) return { datos: { marca: local.marca, modelo: local.modelo, anio: local.anio }, txt: '✓ Datos tomados de un ingreso anterior de esta patente', cls: 'ok' };
  const clave = (db.taller.apiKey || '').trim();
  if (!clave) return { datos: null, txt: 'Esta patente no está en el sistema y la búsqueda en internet no está activada. Escribe marca, modelo y año a mano.', cls: 'aviso' };
  const r = await consultarPatente(pat, clave).catch(() => ({ ok: false, motivo: 'error' }));
  if (r && r.ok) return { datos: { marca: marcaBonita(r.marca), modelo: modeloBonito(r.modelo), anio: r.anio }, txt: '✓ Datos encontrados. Revísalos y corrige lo que haga falta.', cls: 'ok' };
  const txt = {
    clave: 'La clave de patentes no es válida o está bloqueada (revísala en «Datos del taller»). Escribe los datos a mano.',
    limite: 'Ya no quedan consultas por hoy. Escribe los datos a mano.',
    no_encontrada: 'No se encontró esa patente en el sistema. Escribe marca, modelo y año a mano.',
    red: 'No hay internet para buscar la patente. Escribe los datos a mano.'
  }[r && r.motivo] || 'No se pudo consultar la patente. Escribe los datos a mano.';
  return { datos: null, txt, cls: 'err' };
}

/* ---- «Ingresar auto»: primero se pide la patente; si se encuentra, el formulario sale ya relleno; si no, sale vacío para llenarlo a mano ---- */
function pasoPatente() {
  reiniciarPatente();
  ctx = { tipo: 'paso', draft: { patente: '' }, dirty: false, buscando: false };
  mostrarModal(`
    <div class="sh-head"><h2>Ingresar auto</h2><button class="x" data-act="cerrarModal" aria-label="Cerrar">✕</button></div>
    <div class="sh-body paso">
      <div class="campo"><label for="f-pat0">Escribe la patente del auto</label><input id="f-pat0" class="patente-in" data-f="patente" maxlength="8" autocomplete="off" placeholder="BBCL45"></div>
      <p class="muted" id="pasoMsj">Si el auto ya estuvo antes o la patente se encuentra, el formulario sale con la marca, el modelo y el año puestos.</p>
      <div class="paso-acc">
        <button class="btn primary" data-act="pasoContinuar">Buscar y continuar</button>
        <button class="btn" data-act="pasoManual">Escribir los datos a mano</button>
      </div>
    </div>`);
  setTimeout(() => $('#f-pat0')?.focus(), 50);
}

async function pasoContinuar(manual = false) {
  if (!ctx || ctx.tipo !== 'paso' || ctx.buscando) return;
  const pat = (ctx.draft.patente || '').trim().toUpperCase();
  if (!manual && pat.length < 5) { toast('Escribe la patente completa', true); $('#f-pat0')?.focus(); return; }
  let r = { datos: null, txt: '', cls: '' };
  if (!manual) {
    ctx.buscando = true;
    $('#pasoMsj').textContent = 'Buscando la patente…';
    r = await resolverPatente(pat);
    if (!ctx || ctx.tipo !== 'paso') return; // se cerró la ventana mientras se buscaba
  }
  abrirPres(null);
  ctx.origen = 'autos';
  ctx.draft.patente = pat;
  if (r.datos) { Object.assign(ctx.draft, { marca: r.datos.marca || '', modelo: r.datos.modelo || '', anio: /^\d{4}$/.test(String(r.datos.anio || '').trim()) ? String(r.datos.anio).trim() : '' }); ctx.autoFill = true; }
  patUltima = pat;
  ui.patEstado = r.txt ? { txt: r.txt, cls: r.cls } : null;
  pintarPres();
  setTimeout(() => $(r.datos ? '[data-f="cliente"]' : (pat ? '[data-f="marca"]' : '[data-f="patente"]'))?.focus(), 50);
}

/* =====================================================================
   Vista: Autos
   ===================================================================== */
const ui ={ filtro: 'pendiente', buscar: '', pf: 'todos', bq: '', modo: 'semana', ref: new Date() };
const PESTANAS_AUTOS = [['pendiente', 'En el taller'], ['finalizado', 'Finalizados'], ['retirados', 'Retirados']];

// Cada auto aparece en una sola pestaña: pendiente → «En el taller», finalizado → «Finalizados», retirado → «Retirados».
const pestanaDe = a => (a.retirado ? 'retirados' : a.estado);
// «abandono» no es una pestaña normal: junta los autos con más de 10 meses en el taller (aparecen también en su pestaña).
const enPestana = (a, f) => (f === 'abandono' ? enAlerta(a) : pestanaDe(a) === f);
const coincide = (a, q) => !q || [a.patente, a.marca, a.modelo, a.cliente, a.anio].join(' ').toLowerCase().includes(q);

function autosFiltrados() {
  const q = ui.buscar.trim().toLowerCase();
  return db.autos
    .filter(a => enPestana(a, ui.filtro) && coincide(a, q))
    .sort((x, y) => (ui.filtro === 'abandono' ? baseFecha(x).localeCompare(baseFecha(y)) : (y.ingreso || '').localeCompare(x.ingreso || '')));
}

function cuentaFiltro(f) {
  return db.autos.filter(a => enPestana(a, f)).length;
}

function celdaPago(a) {
  if (!a.total && !pagado(a)) return { ab: '<span class="muted">—</span>', fal: '<span class="muted">Sin total</span>' };
  const sd = saldo(a);
  const ab = pagado(a) ? clp(pagado(a)) : '<span class="muted">$ 0</span>';
  const fal = sd > 0 ? `<span class="debe">${clp(sd)}</span>` : sd === 0 ? '<span class="ok">✓ Pagado</span>' : `<span class="ok">Pagó de más ${clp(-sd)}</span>`;
  return { ab, fal };
}

function tablaAutos() {
  const lista = autosFiltrados();
  if (!lista.length) {
    const q = ui.buscar.trim().toLowerCase();
    if (q) {
      const otras = PESTANAS_AUTOS.filter(([k]) => k !== ui.filtro)
        .map(([k, l]) => [l, db.autos.filter(a => enPestana(a, k) && coincide(a, q)).length]).filter(([, n]) => n);
      return `<div class="vacio"><b>No se encontró nada en esta pestaña</b>${otras.length ? 'Pero hay resultados en: ' + otras.map(([l, n]) => `${l} (${n})`).join(', ') : 'Prueba con otra patente, marca o cliente.'}</div>`;
    }
    const msj = {
      pendiente: ['No hay autos pendientes en el taller', db.autos.length ? 'Los autos terminados están en «Finalizados».' : 'Toca el botón amarillo «Ingresar auto», haz el presupuesto y, cuando el cliente lo apruebe, el auto queda aquí.'],
      finalizado: ['No hay autos finalizados esperando retiro', 'Cuando termines un auto, aparece aquí hasta que lo retiren.'],
      retirados: ['Todavía no hay autos retirados', 'Aquí queda el historial de los autos que ya se entregaron.'],
      abandono: ['No hay autos con más de 10 meses en el taller', 'Aquí aparecen los autos que llevan mucho tiempo sin retirarse.']
    }[ui.filtro];
    return `<div class="vacio"><b>${msj[0]}</b>${msj[1]}</div>`;
  }
  return `<table class="tabla">
    <thead><tr><th>Patente</th><th>Marca y modelo</th><th>Año</th><th>Estado</th><th class="r">Total</th><th class="r">Abonado</th><th class="r">Falta pagar</th></tr></thead>
    <tbody>${lista.map(a => {
      const c = celdaPago(a);
      return `<tr data-act="abrirAuto" data-id="${a.id}">
        <td><span class="patente">${esc(a.patente)}</span></td>
        <td><b>${esc(a.marca)} ${esc(a.modelo)}</b><small>${esc(a.cliente || 'Sin cliente')}${a.retirado ? ' · retirado el ' + fecha(a.retiradoEl) : ''}</small></td>
        <td>${esc(a.anio) || '—'}</td>
        <td><span class="badge ${a.estado}">${ESTADOS[a.estado]}</span>${enAlerta(a) ? `<small class="alerta-fila">⚠ ${textoTiempo(mesesEnTaller(a))} en el taller</small>` : ''}</td>
        <td class="r">${a.total ? clp(a.total) : '<span class="muted">—</span>'}</td>
        <td class="r">${c.ab}</td>
        <td class="r">${c.fal}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function vistaAutos() {
  const t = db.taller;
  const faltan = !t.telefono.trim() || !t.mecanico.trim();
  if (ui.filtro === 'abandono' && !cuentaFiltro('abandono')) ui.filtro = 'pendiente';
  const nAlerta = cuentaFiltro('abandono');
  return `
    <div class="top">
      <div><h1>Autos</h1><p>Los autos aprobados por el cliente: en el taller, terminados y ya retirados</p></div>
      <button class="btn primary" data-act="nuevoAuto">＋ Ingresar auto</button>
    </div>
    <div id="bannerAlerta">${bannerAlerta(nAlerta)}</div>
    ${faltan ? `<div class="aviso"><span>Falta completar el teléfono y el nombre del mecánico (salen en los presupuestos).</span><button class="btn small dark" data-act="ir" data-v="taller">Completar datos</button></div>` : ''}
    <div class="barra">
      <div class="chips" id="chips">${chipsHtml()}</div>
      <input class="buscar" id="buscar" type="search" placeholder="🔍  Buscar patente, marca o cliente" value="${esc(ui.buscar)}" style="max-width:340px">
    </div>
    <div class="panel" id="lista">${tablaAutos()}</div>`;
}
function bannerAlerta(n) {
  if (!n || ui.filtro === 'abandono') return '';
  return `<div class="aviso alerta"><span>⚠ ${n} auto${n > 1 ? 's llevan' : ' lleva'} más de ${MESES_ALERTA} meses en el taller. Conviene avisar al dueño por escrito antes de que se cumpla el año.</span><button class="btn small dark" data-act="filtro" data-v="abandono">Ver ${n > 1 ? 'los autos' : 'el auto'}</button></div>`;
}
function chipsHtml() {
  const pestanas = [...PESTANAS_AUTOS];
  if (cuentaFiltro('abandono')) pestanas.push(['abandono', '⚠ Más de ' + MESES_ALERTA + ' meses']);
  return pestanas.map(([k, l]) => `<button class="chip ${k === 'abandono' ? 'chip-alerta' : ''} ${ui.filtro === k ? 'on' : ''}" data-act="filtro" data-v="${k}">${l}<b>${cuentaFiltro(k)}</b></button>`).join('');
}
function pintarAutos() {
  if (ui.filtro === 'abandono' && !cuentaFiltro('abandono')) ui.filtro = 'pendiente';
  $('#lista').innerHTML = tablaAutos();
  $('#chips').innerHTML = chipsHtml();
  $('#bannerAlerta').innerHTML = bannerAlerta(cuentaFiltro('abandono'));
}

/* ---- formulario de auto ---- */
function nuevoAutoVacio() {
  return { id: null, patente: '', marca: '', modelo: '', anio: '', cliente: '', telefono: '', rut: '', contacto: '', km: '', trabajo: '', estadoIngreso: '', estado: 'pendiente', total: 0, pagos: [], ingreso: hoy(), recepcionFirmada: '', avisadoEl: '', finalizadoEl: null, retirado: false, retiradoEl: null, presupuestoId: null };
}

function abrirAuto(id) {
  const a = id ? db.autos.find(x => x.id === id) : null;
  reiniciarPatente();
  ctx = { tipo: 'auto', draft: a ? clone(a) : nuevoAutoVacio(), dirty: false };
  pintarAuto();
  if (!a) setTimeout(() => $('[data-f="patente"]')?.focus(), 50);
}

function htmlResumen(a) {
  const pg = pagado(a), sd = saldo(a);
  let ultima;
  if (!a.total && !pg) ultima = '<div class="fila grande"><span>Falta poner el total</span><b>—</b></div>';
  else if (sd > 0) ultima = `<div class="fila grande debe-b"><span>Falta pagar</span><b>${clp(sd)}</b></div>`;
  else if (sd === 0) ultima = '<div class="fila grande ok-b"><span>✓ Pagado completo</span><b>$ 0</b></div>';
  else ultima = `<div class="fila grande ok-b"><span>Pagó de más</span><b>${clp(-sd)}</b></div>`;
  return `<div class="fila"><span>Total del trabajo</span><b>${clp(a.total)}</b></div>
          <div class="fila"><span>Abonado hasta ahora</span><b>${clp(pg)}</b></div>${ultima}`;
}

function pintarAuto() {
  const a = ctx.draft, nuevo = !a.id;
  const sd = saldo(a);
  mostrarModal(`
    <div class="sh-head"><h2>${nuevo ? 'Ingresar auto al taller' : 'Auto ' + esc(a.patente)}</h2><button class="x" data-act="cerrarModal" aria-label="Cerrar">✕</button></div>
    <div class="sh-body cols">
      <section>
        <h3>Datos del auto</h3>
        <div class="bloque stack">
          <div class="campo"><label for="f-pat">Patente *</label><input id="f-pat" class="patente-in" data-f="patente" value="${esc(a.patente)}" maxlength="8" autocomplete="off" placeholder="BBCL45"></div>
          ${patLinea()}
          <div class="grid3">
            <div class="campo"><label for="f-mar">Marca *</label><input id="f-mar" data-f="marca" list="marcas" value="${esc(a.marca)}" placeholder="Toyota" autocomplete="off"></div>
            <div class="campo"><label for="f-mod">Modelo</label><input id="f-mod" data-f="modelo" value="${esc(a.modelo)}" placeholder="Yaris"></div>
            <div class="campo"><label for="f-anio">Año</label><input id="f-anio" data-f="anio" inputmode="numeric" maxlength="4" value="${esc(a.anio)}" placeholder="2015"></div>
          </div>
          ${FUNCIONES_LEGALES ? `<div class="grid2">
            <div class="campo"><label for="f-ing">Fecha de ingreso</label><input id="f-ing" type="date" data-f="ingreso" value="${esc(a.ingreso)}"></div>
            <div class="campo"><label for="f-km">Kilometraje</label><input id="f-km" class="money" data-f="km" inputmode="numeric" value="${a.km ? miles(a.km) : ''}" placeholder="Ej: 85.000"></div>
          </div>` : ''}
          <div class="grid2">
            <div class="campo"><label for="f-cli">Dueño / cliente</label><input id="f-cli" data-f="cliente" value="${esc(a.cliente)}" placeholder="Nombre"></div>
            <div class="campo"><label for="f-tel">Teléfono</label><input id="f-tel" data-f="telefono" value="${esc(a.telefono)}" placeholder="+56 9 ..."></div>
          </div>
          ${FUNCIONES_LEGALES ? `<div class="grid2">
            <div class="campo"><label for="f-rut">RUT del dueño</label><input id="f-rut" data-f="rut" value="${esc(a.rut)}" placeholder="12.345.678-9"></div>
            <div class="campo"><label for="f-con">Correo o dirección</label><input id="f-con" data-f="contacto" value="${esc(a.contacto)}" placeholder="Para enviarle avisos"></div>
          </div>` : `<div class="campo"><label for="f-ing">Fecha de ingreso</label><input id="f-ing" type="date" data-f="ingreso" value="${esc(a.ingreso)}"></div>`}
          <div class="campo"><label for="f-tra">Trabajo a realizar</label><textarea id="f-tra" data-f="trabajo" placeholder="Ej: cambio de aceite y revisión de frenos">${esc(a.trabajo)}</textarea></div>
          ${FUNCIONES_LEGALES ? `<div class="campo"><label for="f-est">Estado del vehículo al ingresar</label><textarea id="f-est" data-f="estadoIngreso" placeholder="Ej: rayón en puerta derecha, abolladura en parachoques trasero, deja radio y rueda de repuesto">${esc(a.estadoIngreso)}</textarea></div>` : ''}
        </div>
      </section>
      <section>
        <h3>Estado del auto</h3>
        <div class="estados">${Object.keys(ESTADOS).map(k => `<button type="button" class="est ${k} ${a.estado === k ? 'on' : ''}" data-act="setEstado" data-v="${k}">${ESTADOS[k]}</button>`).join('')}</div>
        <p class="muted" style="margin-top:8px;font-size:.9rem">Pendiente: el auto sigue en el taller. Finalizado: ya está listo para retirar.</p>

        <h3 style="margin-top:22px">Dinero</h3>
        <div class="bloque">
          <div class="campo"><label for="f-tot">Total del trabajo ($)</label><input id="f-tot" class="money" data-f="total" inputmode="numeric" value="${a.total ? miles(a.total) : ''}" placeholder="0"></div>
          <div class="resumen" id="resumen">${htmlResumen(a)}</div>
          <h3 style="margin:18px 0 10px">Abonos</h3>
          ${a.pagos.length ? `<ul class="abonos">${a.pagos.map((p, i) => `<li><span>${fecha(p.fecha)}</span><b>${clp(p.monto)}</b><button class="icon" data-act="quitarAbono" data-i="${i}" title="Quitar este abono" aria-label="Quitar este abono">✕</button></li>`).join('')}</ul>` : '<p class="muted">Todavía no ha abonado nada.</p>'}
          <div class="abonar">
            <div class="campo"><label for="ab-monto">Nuevo abono ($)</label><input id="ab-monto" class="money" inputmode="numeric" placeholder="0"></div>
            <div class="campo"><label for="ab-fecha">Fecha</label><input id="ab-fecha" type="date" value="${hoy()}"></div>
            <button class="btn dark" data-act="addAbono">Agregar</button>
          </div>
          ${sd > 0 && a.total ? `<button class="btn small" style="margin-top:12px" data-act="pagarSaldo">Pagó todo lo que faltaba (${clp(sd)})</button>` : ''}
        </div>

        ${!FUNCIONES_LEGALES ? '' : `<h3 style="margin-top:22px">Orden de recepción y avisos</h3>
        <div class="bloque stack">
          ${!nuevo && enAlerta(a) ? `<div class="aviso alerta" style="margin:0"><span>⚠ Lleva <b>${textoTiempo(mesesEnTaller(a))}</b> en el taller${a.recepcionFirmada ? '' : ' (no hay orden firmada: se cuenta desde el ingreso)'}. El año se cumple el <b>${fecha(venceFecha(a))}</b>.</span></div>` : ''}
          <div class="campo"><label for="f-rec">Orden de recepción firmada el</label><input id="f-rec" type="date" data-f="recepcionFirmada" value="${esc(a.recepcionFirmada)}"></div>
          <button class="btn" data-act="imprimirOrden">🖨 Imprimir orden de recepción</button>
          <p class="muted" style="font-size:.88rem;line-height:1.4;margin-top:-4px">Imprímela cuando entra el auto, que la firme el dueño, y anota aquí la fecha. Desde esa fecha se cuenta el plazo de 1 año.</p>
          ${nuevo ? '' : `
          <hr style="border:0;border-top:1px solid var(--line);width:100%">
          <div class="campo"><label for="f-avi">Se avisó al dueño por escrito el</label><input id="f-avi" type="date" data-f="avisadoEl" value="${esc(a.avisadoEl)}"></div>
          <button class="btn ${enAlerta(a) ? 'dark' : ''}" data-act="imprimirCarta">🖨 Imprimir carta de aviso al dueño</button>`}
        </div>`}
      </section>
    </div>
    <div class="sh-foot">
      ${nuevo ? '' : '<button class="btn danger small" data-act="eliminarAuto">Eliminar</button>'}
      ${a.presupuestoId && db.presupuestos.some(p => p.id === a.presupuestoId) ? '<button class="btn small" data-act="hacerPres">Ver presupuesto</button>' : ''}
      ${nuevo ? '' : a.retirado
        ? '<button class="btn small" data-act="reingresar">Volver al taller</button>'
        : a.estado === 'finalizado' ? '<button class="btn small dark" data-act="retirar">Marcar como retirado</button>' : ''}
      <span class="sp"></span>
      <button class="btn" data-act="cerrarModal">Cancelar</button>
      <button class="btn primary" data-act="guardarAuto">Guardar</button>
    </div>
    <datalist id="marcas">${MARCAS.map(m => `<option value="${m}">`).join('')}</datalist>`, true);
}

async function guardarAuto(opciones = {}) {
  const a = ctx.draft;
  a.patente = a.patente.trim().toUpperCase();
  if (!a.patente) { toast('Falta escribir la patente', true); $('[data-f="patente"]')?.focus(); return false; }
  if (!a.marca.trim()) { toast('Falta escribir la marca', true); $('[data-f="marca"]')?.focus(); return false; }
  if (a.anio && !(/^\d{4}$/.test(a.anio) && +a.anio >= 1900 && +a.anio <= new Date().getFullYear() + 1)) { toast('El año debe tener 4 números, por ejemplo 2015', true); $('[data-f="anio"]')?.focus(); return false; }
  if (!a.retirado && db.autos.some(x => x.id !== a.id && !x.retirado && x.patente === a.patente)) { toast(`Ya hay un auto con la patente ${a.patente} dentro del taller`, true); return false; }
  if (a.estado === 'finalizado') a.finalizadoEl = a.finalizadoEl || hoy(); else a.finalizadoEl = null;
  if (opciones.retirar) { a.retirado = true; a.retiradoEl = hoy(); }
  if (opciones.reingresar) { a.retirado = false; a.retiradoEl = null; }
  if (a.id) db.autos[db.autos.findIndex(x => x.id === a.id)] = a;
  else { a.id = uid(); db.autos.push(a); }
  clearTimeout(borradorT); db.borrador = null;
  if (!(await guardar())) return false;
  ctx.dirty = false;
  return true;
}

/* =====================================================================
   Vista: Presupuestos
   ===================================================================== */
function vistaPres() {
  return `
    <div class="top">
      <div><h1>Presupuestos</h1><p>Cuando el cliente aprueba un presupuesto, el auto entra al taller como «Pendiente»</p></div>
      <button class="btn primary" data-act="nuevoPres">＋ Nuevo presupuesto</button>
    </div>
    <div class="barra">
      <div class="chips" id="chipsPres">${chipsPresHtml()}</div>
      <input class="buscar" id="buscarPres" type="search" placeholder="🔍  Buscar por cliente, patente o número" value="${esc(ui.bq)}" style="max-width:380px">
    </div>
    <div class="panel" id="listaPres">${tablaPres()}</div>`;
}

const PESTANAS_PRES = [['todos', 'Todos'], ['espera', 'En espera'], ['aprobado', 'Aprobados'], ['rechazado', 'Rechazados']];
const cuentaPres = f => (f === 'todos' ? db.presupuestos.length : db.presupuestos.filter(p => p.estado === f).length);
const chipsPresHtml = () => PESTANAS_PRES.map(([k, l]) => `<button class="chip ${ui.pf === k ? 'on' : ''}" data-act="filtroPres" data-v="${k}">${l}<b>${cuentaPres(k)}</b></button>`).join('');
const refrescarListaPres = () => { $('#listaPres').innerHTML = tablaPres(); $('#chipsPres').innerHTML = chipsPresHtml(); };

function tablaPres() {
  const q = ui.bq.trim().toLowerCase();
  const lista = db.presupuestos
    .filter(p => (ui.pf === 'todos' || p.estado === ui.pf) && (!q || [p.numero, p.cliente, p.patente, p.marca, p.modelo].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.numero - a.numero);
  if (!lista.length) {
    if (!db.presupuestos.length) return '<div class="vacio"><b>Todavía no hay presupuestos</b>Toca «Nuevo presupuesto» para crear el primero.</div>';
    return `<div class="vacio"><b>No hay presupuestos para mostrar</b>${ui.pf === 'espera' ? 'No queda ninguno esperando respuesta del cliente.' : 'Prueba con otra pestaña o cambia lo que buscas.'}</div>`;
  }
  return `<table class="tabla">
    <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Auto</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.map(p => `<tr data-act="abrirPres" data-id="${p.id}">
      <td><b>${String(p.numero).padStart(4, '0')}</b></td>
      <td>${fecha(p.fecha)}</td>
      <td>${esc(p.cliente) || '<span class="muted">—</span>'}</td>
      <td>${p.patente ? `<span class="patente" style="font-size:1rem;padding:3px 9px">${esc(p.patente)}</span> ` : ''}${esc(p.marca)} ${esc(p.modelo)}</td>
      <td class="r"><b>${clp(totalPres(p).total)}</b></td>
      <td><span class="badge ${p.estado}">${ESTADOS_PRES[p.estado]}</span></td>
      <td class="r"><button class="btn small" data-act="imprimirFila" data-id="${p.id}">🖨 Imprimir</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function nuevoPresVacio() {
  return {
    id: null, numero: null, estado: 'espera', fecha: hoy(), validez: db.taller.validez || 15,
    cliente: '', telefono: '', patente: '', marca: '', modelo: '', anio: '',
    items: [{ desc: '', cant: '1', precio: 0 }], iva: false, notas: '', autoId: null
  };
}

function abrirPres(id) {
  const p = id ? db.presupuestos.find(x => x.id === id) : null;
  reiniciarPatente();
  ctx = { tipo: 'pres', draft: p ? clone(p) : nuevoPresVacio(), dirty: false };
  pintarPres();
}

function filaItem(it, i) {
  return `<tr>
    <td><input data-i="${i}" data-f="desc" value="${esc(it.desc)}" placeholder="Ej: Cambio de pastillas de freno" aria-label="Descripción"></td>
    <td class="c-cant"><input class="n" data-i="${i}" data-f="cant" inputmode="decimal" value="${esc(it.cant)}" aria-label="Cantidad"></td>
    <td class="c-pre"><input class="money" data-i="${i}" data-f="precio" inputmode="numeric" value="${it.precio ? miles(it.precio) : ''}" placeholder="0" aria-label="Precio unitario"></td>
    <td class="sub c-sub" id="sub${i}">${clp(subItem(it))}</td>
    <td class="c-x"><button class="icon" data-act="quitarItem" data-i="${i}" title="Quitar esta línea" aria-label="Quitar esta línea">✕</button></td>
  </tr>`;
}

function pintarPres() {
  const p = ctx.draft, nuevo = !p.id, t = totalPres(p);
  const enTaller = p.autoId && db.autos.find(a => a.id === p.autoId);
  mostrarModal(`
    <div class="sh-head"><h2>${nuevo ? (ctx.origen === 'autos' ? 'Ingresar auto' : 'Nuevo presupuesto') : 'Presupuesto N° ' + String(p.numero).padStart(4, '0')} <span class="badge ${p.estado}" style="margin-left:10px;font-size:.85rem;background:#fff">${ESTADOS_PRES[p.estado]}</span></h2><button class="x" data-act="cerrarModal" aria-label="Cerrar">✕</button></div>
    <div class="sh-body">
      ${nuevo ? '<p class="muted" style="margin-bottom:14px;line-height:1.45">Aquí se ingresa el auto: completa sus datos y lo que se va a hacer. Cuando el cliente apruebe, toca <b>«✓ Aprobado: ingresar al taller»</b> y el auto queda en la lista de Autos.</p>' : ''}
      <div class="bloque stack">
        <div class="grid4">
          <div class="campo"><label for="p-cli">Cliente</label><input id="p-cli" data-f="cliente" value="${esc(p.cliente)}" placeholder="Nombre"></div>
          <div class="campo"><label for="p-tel">Teléfono</label><input id="p-tel" data-f="telefono" value="${esc(p.telefono)}"></div>
          <div class="campo"><label for="p-fec">Fecha</label><input id="p-fec" type="date" data-f="fecha" value="${esc(p.fecha)}"></div>
          <div class="campo"><label for="p-val">Válido (días)</label><input id="p-val" class="n" data-f="validez" inputmode="numeric" value="${esc(p.validez)}"></div>
        </div>
        <div class="grid4">
          <div class="campo"><label for="p-pat">Patente</label><input id="p-pat" class="patente-in" data-f="patente" value="${esc(p.patente)}" maxlength="8" autocomplete="off"></div>
          <div class="campo"><label for="p-mar">Marca</label><input id="p-mar" data-f="marca" list="marcas" value="${esc(p.marca)}" autocomplete="off"></div>
          <div class="campo"><label for="p-mod">Modelo</label><input id="p-mod" data-f="modelo" value="${esc(p.modelo)}"></div>
          <div class="campo"><label for="p-ani">Año</label><input id="p-ani" class="n" data-f="anio" inputmode="numeric" maxlength="4" value="${esc(p.anio)}"></div>
        </div>
        ${patLinea()}
      </div>

      <div class="bloque">
        <h3>Trabajos y repuestos</h3>
        <table class="items">
          <thead><tr><th>Descripción</th><th class="c-cant">Cant.</th><th class="c-pre">Precio unitario</th><th class="c-sub" style="text-align:right">Subtotal</th><th></th></tr></thead>
          <tbody id="itemsBody">${p.items.map(filaItem).join('')}</tbody>
        </table>
        <button class="btn small" data-act="addItem">＋ Agregar otra línea</button>
        <div class="totales">
          <div class="resumen">
            <div class="fila"><span>Subtotal</span><b id="tSub">${clp(t.sub)}</b></div>
            <div class="fila" id="filaIva" ${p.iva ? '' : 'hidden'}><span>IVA 19%</span><b id="tIva">${clp(t.iva)}</b></div>
            <div class="fila grande"><span>Total</span><b id="tTot">${clp(t.total)}</b></div>
          </div>
          <label class="check" style="margin-top:12px"><input type="checkbox" data-f="iva" ${p.iva ? 'checked' : ''}> Agregar IVA (19%)</label>
        </div>
      </div>

      <div class="bloque"><div class="campo"><label for="p-not">Observaciones (salen al pie del presupuesto)</label><textarea id="p-not" data-f="notas" placeholder="${esc(db.taller.pie)}">${esc(p.notas)}</textarea></div></div>
    </div>
    <div class="sh-foot">
      ${nuevo ? '' : '<button class="btn danger small" data-act="eliminarPres">Eliminar</button>'}
      <button class="btn small" data-act="imprimirPres">🖨 Imprimir / PDF</button>
      ${p.estado === 'aprobado' ? `<span class="ok">✓ Aprobado${enTaller ? ' · el auto está en el taller' : ''}</span>` : ''}
      ${p.estado === 'rechazado' ? '<button class="btn small" data-act="reabrirPres">Volver a poner en espera</button>' : ''}
      <span class="sp"></span>
      <button class="btn" data-act="cerrarModal">${p.estado === 'espera' ? 'Cancelar' : 'Cerrar'}</button>
      <button class="btn" data-act="guardarPres">Guardar</button>
      ${p.estado === 'espera' ? '<button class="btn danger" data-act="rechazarPres">✗ Rechazado</button><button class="btn primary" data-act="aprobarPres">✓ Aprobado: ingresar al taller</button>' : ''}
    </div>
    <datalist id="marcas">${MARCAS.map(m => `<option value="${m}">`).join('')}</datalist>`, true);
}

function pintarTotalesPres() {
  const p = ctx.draft, t = totalPres(p);
  p.items.forEach((it, i) => { const el = $('#sub' + i); if (el) el.textContent = clp(subItem(it)); });
  $('#tSub').textContent = clp(t.sub);
  $('#tIva').textContent = clp(t.iva);
  $('#tTot').textContent = clp(t.total);
  $('#filaIva').hidden = !p.iva;
}

function limpiarPres(p) {
  p.patente = p.patente.trim().toUpperCase();
  p.items = p.items.filter(it => it.desc.trim() || it.precio);
  return p;
}

async function guardarPres() {
  const p = limpiarPres(ctx.draft);
  if (!p.items.length) { toast('Agrega al menos una línea con el trabajo y su precio', true); return false; }
  if (!p.numero) { p.numero = db.contador++; }
  if (!p.id) { p.id = uid(); db.presupuestos.push(p); }
  else db.presupuestos[db.presupuestos.findIndex(x => x.id === p.id)] = p;
  // Si el presupuesto está ligado a un auto, el total del auto se mantiene al día.
  const a = p.autoId && db.autos.find(x => x.id === p.autoId);
  if (a) { a.total = totalPres(p).total; a.presupuestoId = p.id; }
  clearTimeout(borradorT); db.borrador = null;
  if (!(await guardar())) return false;
  ctx.dirty = false;
  return true;
}

/* ---- impresión ---- */
function cabeceraDoc() {
  const t = db.taller;
  return `<h1>${esc(t.nombre)}</h1>
    ${t.direccion ? `<p>${esc(t.direccion)}</p>` : ''}
    ${t.telefono ? `<p>Teléfono: ${esc(t.telefono)}${t.email ? ' · ' + esc(t.email) : ''}</p>` : t.email ? `<p>${esc(t.email)}</p>` : ''}
    ${t.mecanico ? `<p>Mecánico: ${esc(t.mecanico)}</p>` : ''}`;
}

function imprimir(html) {
  $('#printArea').innerHTML = html;
  setTimeout(() => window.print(), 80);
}

function docPresupuesto(p) {
  const t = totalPres(p), ver = db.taller;
  const num = p.numero ? String(p.numero).padStart(4, '0') : '(sin guardar)';
  const val = dec(p.validez);
  return `<div class="doc">
    <div class="doc-head">
      <div>${cabeceraDoc()}</div>
      <div class="doc-num"><h2>PRESUPUESTO</h2><p><b>N° ${num}</b></p><p>Fecha: ${fecha(p.fecha)}</p>${val ? `<p>Válido por ${val} días</p>` : ''}</div>
    </div>
    <div class="doc-box">
      <div><b>Cliente:</b> ${esc(p.cliente) || '—'}</div><div><b>Teléfono:</b> ${esc(p.telefono) || '—'}</div>
      <div><b>Vehículo:</b> ${esc(p.marca)} ${esc(p.modelo)} ${p.anio ? '(' + esc(p.anio) + ')' : ''}</div><div><b>Patente:</b> ${esc(p.patente) || '—'}</div>
    </div>
    <table class="doc-tabla">
      <thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio unit.</th><th class="r">Subtotal</th></tr></thead>
      <tbody>${p.items.filter(it => it.desc.trim() || it.precio).map(it => `<tr><td>${esc(it.desc)}</td><td class="r">${esc(it.cant)}</td><td class="r">${clp(it.precio)}</td><td class="r">${clp(subItem(it))}</td></tr>`).join('')}</tbody>
    </table>
    <div class="doc-tot">
      ${p.iva ? `<div><span>Subtotal</span><span>${clp(t.sub)}</span></div><div><span>IVA 19%</span><span>${clp(t.iva)}</span></div>` : ''}
      <div class="t"><span>TOTAL</span><span>${clp(t.total)}</span></div>
    </div>
    <div class="doc-notas">${esc(p.notas || ver.pie)}</div>
    ${FUNCIONES_LEGALES && ver.aviso42 ? `<div class="doc-legal">${esc(ver.aviso42)}</div>` : ''}
    <div class="doc-firma"><div>Firma del taller${ver.mecanico ? ' — ' + esc(ver.mecanico) : ''}</div><div>Aceptado por el cliente</div></div>
  </div>`;
}

/* ---- orden de recepción del vehículo (documento que se firma al ingresar) ---- */
const lineasDoc = n => Array.from({ length: n }, () => '<div class="doc-linea"></div>').join('');

function docOrden(a) {
  // La fecha del documento es la de hoy (cuando se firma), aunque el auto haya ingresado antes.
  const t = db.taller, f = hoy();
  const d = parseISO(f), limite = iso(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
  const total = a.total ? `<div><b>Valor del trabajo:</b> ${clp(a.total)}</div>` : '';
  return `<div class="doc">
    <div class="doc-head">
      <div>${cabeceraDoc()}</div>
      <div class="doc-num"><h2>ORDEN DE RECEPCIÓN</h2><p><b>Patente ${esc(a.patente) || '—'}</b></p><p>Fecha: ${fecha(f)}</p></div>
    </div>
    <div class="doc-box">
      <div><b>Cliente:</b> ${esc(a.cliente) || '—'}</div><div><b>RUT:</b> ${esc(a.rut) || '—'}</div>
      <div><b>Teléfono:</b> ${esc(a.telefono) || '—'}</div><div><b>Correo o dirección:</b> ${esc(a.contacto) || '—'}</div>
    </div>
    <div class="doc-box">
      <div><b>Vehículo:</b> ${esc(a.marca)} ${esc(a.modelo)}</div><div><b>Año:</b> ${esc(a.anio) || '—'}</div>
      <div><b>Patente:</b> ${esc(a.patente) || '—'}</div><div><b>Kilometraje:</b> ${a.km ? miles(a.km) + ' km' : '—'}</div>
      <div><b>Ingreso al taller:</b> ${fecha(a.ingreso || f)}</div>${total}
    </div>
    <div class="doc-sec"><b>Trabajo a realizar</b>${a.trabajo ? `<div class="doc-notas" style="margin-top:4px">${esc(a.trabajo)}</div>` : lineasDoc(2)}</div>
    <div class="doc-sec"><b>Estado del vehículo al ingresar</b> <span class="doc-peq">(golpes, rayones, daños, luces, neumáticos)</span>${a.estadoIngreso ? `<div class="doc-notas" style="margin-top:4px">${esc(a.estadoIngreso)}</div>` : lineasDoc(3)}</div>
    <div class="doc-sec"><b>Objetos dejados en el vehículo</b>${lineasDoc(1)}</div>
    <div class="doc-decl">
      <p><b>Declaración del cliente</b></p>
      <ol>
        <li>Declaro que los datos indicados son correctos y que entrego el vehículo en el estado descrito en este documento.</li>
        <li>Autorizo al taller a contactarme por teléfono, correo o por escrito, a los datos indicados, para informarme del avance del trabajo y de cualquier asunto relativo a este vehículo.</li>
        <li>Me comprometo a retirar el vehículo una vez terminado el trabajo y a pagar lo que corresponda.</li>
        ${t.aviso42 ? `<li>He leído y entiendo el siguiente aviso: <i>${esc(t.aviso42.replace(/^AVISO LEGAL\s*/i, ''))}</i> El plazo para retirar este vehículo vence el <b>${fecha(limite)}</b>, contado desde la fecha en que se firma este documento.</li>` : ''}
      </ol>
    </div>
    <div class="doc-firma"><div>Firma del taller${t.mecanico ? ' — ' + esc(t.mecanico) : ''}</div><div>Firma del cliente<br>${esc(a.cliente)}${a.rut ? ' · RUT ' + esc(a.rut) : ''}</div></div>
  </div>`;
}

/* ---- carta de aviso al dueño de un auto que lleva mucho tiempo sin retirarse ---- */
function docCarta(a) {
  const t = db.taller, base = baseFecha(a), sd = saldo(a);
  const estado = a.estado === 'finalizado' ? 'con el trabajo terminado y listo para ser retirado' : 'en nuestro taller';
  return `<div class="doc">
    <div class="doc-head">
      <div>${cabeceraDoc()}</div>
      <div class="doc-num"><h2>AVISO</h2><p>Fecha: ${fecha(hoy())}</p></div>
    </div>
    <div class="doc-box" style="grid-template-columns:1fr">
      <div><b>Señor(a):</b> ${esc(a.cliente) || '—'}${a.rut ? ' · RUT ' + esc(a.rut) : ''}</div>
      ${a.contacto ? `<div><b>Domicilio / correo:</b> ${esc(a.contacto)}</div>` : ''}
      <div><b>Ref.:</b> Vehículo ${esc(a.marca)} ${esc(a.modelo)} ${a.anio ? '(' + esc(a.anio) + ')' : ''}, patente <b>${esc(a.patente)}</b></div>
    </div>
    <div class="doc-carta">
      <p>Estimado(a) ${esc(a.cliente) || 'cliente'}:</p>
      <p>Le informamos que su vehículo patente <b>${esc(a.patente)}</b> ingresó a nuestro taller el <b>${fecha(a.ingreso || base)}</b> y se encuentra ${estado}. A la fecha, el vehículo <b>no ha sido retirado</b>${sd > 0 ? `, y según nuestros registros queda un saldo pendiente de <b>${clp(sd)}</b>` : ''}.</p>
      <p>Le solicitamos retirarlo a la brevedad, coordinando con nosotros${t.telefono ? ' al teléfono <b>' + esc(t.telefono) + '</b>' : ''}${t.direccion ? ' o en ' + esc(t.direccion) : ''}.</p>
      <p>Le recordamos que, de acuerdo con el artículo 42 de la Ley N° 19.496, las especies entregadas en reparación que no sean retiradas en el plazo de un año contado desde la fecha del documento de recepción del trabajo se entienden abandonadas en favor del proveedor. En este caso, ese plazo se cumple el <b>${fecha(venceFecha(a))}</b>.</p>
      <p>Quedamos atentos a su respuesta.</p>
      <p style="margin-top:14px">Atentamente,</p>
    </div>
    <div class="doc-firma" style="margin-top:50px"><div>${esc(t.nombre)}${t.mecanico ? ' — ' + esc(t.mecanico) : ''}</div><div>Recibido por el cliente (nombre, firma y fecha)</div></div>
  </div>`;
}

/* =====================================================================
   Vista: Ventas
   ===================================================================== */
function periodo(modo, ref) {
  if (modo === 'semana') {
    const s = lunes(ref), e = addDias(s, 6);
    const etiqueta = s.getMonth() === e.getMonth()
      ? `${s.getDate()} – ${e.getDate()} ${MESES_C[e.getMonth()]} ${e.getFullYear()}`
      : `${s.getDate()} ${MESES_C[s.getMonth()]} – ${e.getDate()} ${MESES_C[e.getMonth()]} ${e.getFullYear()}`;
    return { s, e, ini: iso(s), fin: iso(e), etiqueta };
  }
  const s = new Date(ref.getFullYear(), ref.getMonth(), 1), e = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { s, e, ini: iso(s), fin: iso(e), etiqueta: `${MESES[s.getMonth()]} ${s.getFullYear()}` };
}
const mover = (modo, ref, n) => (modo === 'semana' ? addDias(ref, 7 * n) : new Date(ref.getFullYear(), ref.getMonth() + n, 1));
const entre = (f, ini, fin) => f >= ini && f <= fin;
const sumaPeriodo = (pagos, p) => pagos.filter(x => entre(x.fecha, p.ini, p.fin)).reduce((s, x) => s + x.monto, 0);

function barras(items) {
  const max = Math.max(1, ...items.map(i => i.v));
  return `<div class="barras">${items.map(i => {
    const h = i.v / max * 86;
    return `<div class="col ${i.v ? '' : 'cero'} ${i.on ? 'on' : ''} ${i.ref ? 'clic' : ''}" ${i.ref ? `data-act="irPeriodo" data-ref="${i.ref}"` : ''} title="${esc(i.tip)}">
      ${i.val && i.v ? `<span class="val" style="bottom:calc(${h}% + 5px)">${corto(i.v)}</span>` : ''}<i style="height:${h}%"></i></div>`;
  }).join('')}</div>
  <div class="ejex">${items.map(i => `<span class="${i.on ? 'on' : ''}">${i.l}</span>`).join('')}</div>`;
}

function datosVentas() {
  const modo = ui.modo, per = periodo(modo, ui.ref), ant = periodo(modo, mover(modo, ui.ref, -1));
  const pagos = todosPagos();
  const ing = sumaPeriodo(pagos, per), ingAnt = sumaPeriodo(pagos, ant);
  const porDia = {};
  pagos.filter(x => entre(x.fecha, per.ini, per.fin)).forEach(x => { porDia[x.fecha] = (porDia[x.fecha] || 0) + x.monto; });
  const dias = [];
  for (let d = new Date(per.s); d <= per.e; d = addDias(d, 1)) dias.push(new Date(d));
  return {
    modo, per, ant, pagos, ing, ingAnt, porDia, dias,
    detalle: pagos.filter(x => entre(x.fecha, per.ini, per.fin)).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    terminados: db.autos.filter(a => a.finalizadoEl && entre(a.finalizadoEl, per.ini, per.fin)).length,
    ingresados: db.autos.filter(a => a.ingreso && entre(a.ingreso, per.ini, per.fin)).length,
    porCobrar: db.autos.filter(a => saldo(a) > 0).reduce((s, a) => s + saldo(a), 0),
    sinAprobar: db.presupuestos.filter(p => p.estado === 'espera').reduce((s, p) => s + totalPres(p).total, 0)
  };
}

function textoCambio(v) {
  if (!v.ingAnt) return `<span class="s">Sin ingresos en el período anterior</span>`;
  const pct = Math.round((v.ing - v.ingAnt) / v.ingAnt * 100);
  const up = pct >= 0;
  return `<span class="${up ? 'sube' : 'baja'}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span> <span class="s">vs ${v.modo === 'semana' ? 'semana' : 'mes'} anterior (${clp(v.ingAnt)})</span>`;
}

function vistaVentas() {
  const v = datosVentas(), sem = v.modo === 'semana';
  const barrasPeriodo = barras(v.dias.map((d, i) => {
    const k = iso(d), val = v.porDia[k] || 0;
    return {
      v: val, val: sem || v.dias.length <= 16,
      l: sem ? `${DIAS_C[i]}<br>${d.getDate()}` : (d.getDate() === 1 || d.getDate() % 5 === 0 ? d.getDate() : ''),
      tip: `${d.getDate()} de ${MESES[d.getMonth()]}: ${clp(val)}`
    };
  }));
  const hist = [];
  for (let k = (sem ? -7 : -11); k <= 0; k++) {
    const ref = mover(v.modo, ui.ref, k), p = periodo(v.modo, ref);
    hist.push({ v: sumaPeriodo(v.pagos, p), val: true, on: k === 0, ref: iso(ref), l: sem ? `${p.s.getDate()}/${p.s.getMonth() + 1}` : MESES_C[p.s.getMonth()], tip: `${p.etiqueta}: ${clp(sumaPeriodo(v.pagos, p))}` });
  }
  return `
    <div class="top">
      <div><h1>Ventas</h1><p>Ingresos según los pagos y abonos que fuiste anotando</p></div>
      <button class="btn" data-act="imprimirInforme">🖨 Imprimir informe</button>
    </div>
    <div class="barra" style="justify-content:space-between">
      <div class="modo"><button class="${sem ? 'on' : ''}" data-act="setModo" data-v="semana">Semanal</button><button class="${sem ? '' : 'on'}" data-act="setModo" data-v="mes">Mensual</button></div>
      <div class="navper">
        <button class="btn small" data-act="mover" data-n="-1" aria-label="Período anterior">◀</button>
        <div class="etq">${v.per.etiqueta}</div>
        <button class="btn small" data-act="mover" data-n="1" aria-label="Período siguiente">▶</button>
        <button class="btn small" data-act="hoyPeriodo">${sem ? 'Esta semana' : 'Este mes'}</button>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi grande"><small>Ingresos ${sem ? 'de la semana' : 'del mes'}</small><span class="v">${clp(v.ing)}</span>${textoCambio(v)}</div>
      <div class="kpi"><small>Autos terminados</small><span class="v">${v.terminados}</span><span class="s">en ${sem ? 'esta semana' : 'este mes'}</span></div>
      <div class="kpi"><small>Autos que entraron</small><span class="v">${v.ingresados}</span><span class="s">en ${sem ? 'esta semana' : 'este mes'}</span></div>
      <div class="kpi"><small>Por cobrar hoy</small><span class="v">${clp(v.porCobrar)}</span><span class="s">presupuestos en espera: ${clp(v.sinAprobar)}</span></div>
    </div>

    <div class="dos">
      <div class="panel graf-box"><h3>Ingresos por día</h3><div class="sub">${v.per.etiqueta}</div>${barrasPeriodo}</div>
      <div class="panel graf-box"><h3>${sem ? 'Últimas 8 semanas' : 'Últimos 12 meses'}</h3><div class="sub">Toca una barra para ver ${sem ? 'esa semana' : 'ese mes'}</div>${barras(hist)}</div>
    </div>

    <div class="tit-tabla"><h3>Pagos recibidos en ${sem ? 'la semana' : 'el mes'}</h3><span class="muted">${v.detalle.length} pago${v.detalle.length === 1 ? '' : 's'}</span></div>
    <div class="panel">${v.detalle.length ? `<table class="tabla">
      <thead><tr><th>Fecha</th><th>Patente</th><th>Auto</th><th>Cliente</th><th class="r">Monto</th></tr></thead>
      <tbody>${v.detalle.map(p => `<tr><td>${fecha(p.fecha)}</td><td><span class="patente" style="font-size:1rem;padding:3px 9px">${esc(p.a.patente)}</span></td><td>${esc(p.a.marca)} ${esc(p.a.modelo)}</td><td>${esc(p.a.cliente) || '—'}</td><td class="r"><b>${clp(p.monto)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="r">${clp(v.ing)}</td></tr></tfoot></table>`
      : `<div class="vacio"><b>No hay pagos en ${sem ? 'esta semana' : 'este mes'}</b>Los ingresos aparecen cuando anotas un abono en un auto.</div>`}</div>`;
}

function docInforme() {
  const v = datosVentas(), sem = v.modo === 'semana';
  const diasConPago = v.dias.filter(d => v.porDia[iso(d)]);
  return `<div class="doc">
    <div class="doc-head"><div>${cabeceraDoc()}</div><div class="doc-num"><h2>INFORME DE VENTAS</h2><p><b>${sem ? 'Semana' : 'Mes'}: ${v.per.etiqueta}</b></p><p>Emitido: ${fecha(hoy())}</p></div></div>
    <div class="doc-kpis">
      <div><small>Ingresos</small><b>${clp(v.ing)}</b></div>
      <div><small>Autos terminados</small><b>${v.terminados}</b></div>
      <div><small>Autos que entraron</small><b>${v.ingresados}</b></div>
      <div><small>Por cobrar hoy</small><b>${clp(v.porCobrar)}</b></div>
    </div>
    <h3 style="margin:0 0 8px">Ingresos por día</h3>
    <table class="doc-tabla"><thead><tr><th>Día</th><th class="r">Ingresos</th></tr></thead>
      <tbody>${diasConPago.length ? diasConPago.map(d => `<tr><td>${DIAS_C[(d.getDay() + 6) % 7]} ${fecha(iso(d))}</td><td class="r">${clp(v.porDia[iso(d)])}</td></tr>`).join('') : '<tr><td colspan="2">Sin pagos en el período.</td></tr>'}</tbody></table>
    <h3 style="margin:22px 0 8px">Detalle de pagos</h3>
    <table class="doc-tabla"><thead><tr><th>Fecha</th><th>Patente</th><th>Auto</th><th>Cliente</th><th class="r">Monto</th></tr></thead>
      <tbody>${v.detalle.map(p => `<tr><td>${fecha(p.fecha)}</td><td>${esc(p.a.patente)}</td><td>${esc(p.a.marca)} ${esc(p.a.modelo)}</td><td>${esc(p.a.cliente)}</td><td class="r">${clp(p.monto)}</td></tr>`).join('')}</tbody></table>
    <div class="doc-tot"><div class="t"><span>TOTAL</span><span>${clp(v.ing)}</span></div></div>
  </div>`;
}

/* =====================================================================
   Vista: Datos del taller
   ===================================================================== */
function vistaTaller() {
  const t = db.taller;
  return `
    <div class="top"><div><h1>Datos del taller</h1><p>Esta información sale en los presupuestos impresos</p></div></div>
    <div class="bloque stack" style="max-width:820px">
      <div class="campo"><label for="t-nom">Nombre del taller</label><input id="t-nom" value="${esc(t.nombre)}"></div>
      <div class="campo"><label for="t-dir">Dirección</label><input id="t-dir" value="${esc(t.direccion)}" placeholder="Calle y número, comuna"></div>
      <div class="grid2">
        <div class="campo"><label for="t-tel">Teléfono</label><input id="t-tel" value="${esc(t.telefono)}" placeholder="+56 9 1234 5678"></div>
        <div class="campo"><label for="t-mail">Correo (opcional)</label><input id="t-mail" value="${esc(t.email)}" placeholder="taller@correo.cl"></div>
      </div>
      <div class="grid2">
        <div class="campo"><label for="t-mec">Nombre del mecánico</label><input id="t-mec" value="${esc(t.mecanico)}" placeholder="Nombre y apellido"></div>
        <div class="campo"><label for="t-val">Presupuestos válidos por (días)</label><input id="t-val" class="n" inputmode="numeric" value="${esc(t.validez)}"></div>
      </div>
      <div class="campo"><label for="t-pie">Texto al pie de los presupuestos</label><textarea id="t-pie">${esc(t.pie)}</textarea></div>
      <div class="campo"><label for="t-api">Clave para rellenar el auto con la patente (Boostr.cl)</label><input id="t-api" value="${esc(t.apiKey)}" placeholder="Pega aquí la clave" autocomplete="off" spellcheck="false">
        <small class="muted">Opcional. La clave gratis se pide en <b>api.boostr.cl/patente</b> (5 consultas por día, el primer mes; después hay planes de pago). Sin clave igual se rellenan los autos que ya ingresaste; los demás se escriben a mano.</small></div>
      ${FUNCIONES_LEGALES ? `<div class="campo"><label for="t-av">Aviso legal del artículo 42 (sale en la orden de recepción y en los presupuestos)</label><textarea id="t-av" style="min-height:120px">${esc(t.aviso42)}</textarea>
        <small class="muted">Conviene que un abogado revise este texto. Si lo dejas vacío, no se imprime.</small></div>` : ''}
      <div><button class="btn primary" data-act="guardarTaller">Guardar datos del taller</button></div>
    </div>

    <div class="bloque" style="max-width:820px;margin-top:22px">
      <h3>Copia de seguridad</h3>
      <p class="muted" style="margin:6px 0 14px;line-height:1.45">Todo se guarda solo, en cada cambio. Además se hace una copia automática cada día.
        Para más tranquilidad, guarda una copia en un pendrive o en el correo de vez en cuando.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-act="respaldar">💾 Guardar copia de seguridad</button>
        <button class="btn" data-act="restaurar">📂 Restaurar una copia</button>
        <button class="btn" data-act="abrirCarpeta" id="btnCarpeta">Abrir carpeta de los datos</button>
      </div>
      <p class="muted" id="rutaDatos" style="margin-top:12px;font-size:.88rem"></p>
    </div>`;
}

/* =====================================================================
   Acciones (clics)
   ===================================================================== */
function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const ACT = {
  ir: el => { ui.vista = el.dataset.v; render(); },

  /* autos */
  // Todo auto entra por un presupuesto: «Ingresar auto» abre el formulario de presupuesto.
  nuevoAuto: () => pasoPatente(),
  pasoContinuar: () => pasoContinuar(),
  pasoManual: () => pasoContinuar(true),
  abrirAuto: el => abrirAuto(el.dataset.id),
  filtro: el => { ui.filtro = el.dataset.v; pintarAutos(); },
  cerrarModal: () => cerrarModal(),
  // Al finalizar, el saldo que faltaba se da por pagado (con la fecha de hoy, así entra a Ventas).
  // Si se vuelve a «Pendiente», ese pago automático se quita.
  setEstado: el => {
    const a = ctx.draft, v = el.dataset.v;
    if (a.estado === v) return;
    a.estado = v;
    if (v === 'finalizado') {
      const sd = saldo(a);
      if (sd > 0) { a.pagos.push({ id: uid(), fecha: hoy(), monto: sd, auto: true }); toast(`Finalizado: se registró el pago de ${clp(sd)} (el total) ✓`); }
    } else {
      a.pagos = a.pagos.filter(p => !p.auto);
    }
    ctx.dirty = true; pintarAuto();
  },
  buscarPatente: () => buscarPatente(true),
  addAbono: () => {
    const m = num($('#ab-monto').value), f = $('#ab-fecha').value || hoy();
    if (m <= 0) { toast('Escribe cuánto abonó', true); $('#ab-monto').focus(); return; }
    ctx.draft.pagos.push({ id: uid(), fecha: f, monto: m });
    ctx.dirty = true; pintarAuto();
  },
  quitarAbono: el => { ctx.draft.pagos.splice(+el.dataset.i, 1); ctx.dirty = true; pintarAuto(); },
  pagarSaldo: () => {
    const sd = saldo(ctx.draft);
    if (sd > 0) { ctx.draft.pagos.push({ id: uid(), fecha: hoy(), monto: sd }); ctx.dirty = true; pintarAuto(); }
  },
  guardarAuto: async () => {
    const era = ctx.draft.id;
    if (await guardarAuto()) { await cerrarModal(true); render(); toast(era ? 'Cambios guardados ✓' : 'Auto ingresado ✓'); }
  },
  retirar: async () => {
    const sd = saldo(ctx.draft);
    if (sd > 0 && !(await confirmar({ titulo: 'Todavía debe plata', texto: `A este auto le faltan ${clp(sd)} por pagar. ¿Marcarlo como retirado igual?`, ok: 'Sí, retirado', cancelar: 'No' }))) return;
    if (await guardarAuto({ retirar: true })) { await cerrarModal(true); render(); toast('Auto marcado como retirado ✓'); }
  },
  reingresar: async () => {
    if (await guardarAuto({ reingresar: true })) { await cerrarModal(true); render(); toast('El auto volvió al taller ✓'); }
  },
  eliminarAuto: async () => {
    const a = ctx.draft;
    if (!(await confirmar({ titulo: '¿Eliminar este auto?', texto: `Se borra el auto ${a.patente} con todos sus abonos. Los ingresos de Ventas también bajan. No se puede deshacer.`, ok: 'Sí, eliminar', cancelar: 'No, dejarlo', peligro: true }))) return;
    db.autos = db.autos.filter(x => x.id !== a.id);
    db.presupuestos.forEach(p => { if (p.autoId === a.id) p.autoId = null; });
    await guardar(); await cerrarModal(true); render(); toast('Auto eliminado');
  },
  hacerPres: async () => {
    const pid = ctx.draft.presupuestoId;
    if (!(await guardarAuto())) return;
    await cerrarModal(true);
    abrirPres(pid);
  },

  imprimirOrden: () => {
    if (!ctx.draft.patente.trim()) { toast('Primero escribe la patente del auto', true); $('[data-f="patente"]')?.focus(); return; }
    imprimir(docOrden({ ...ctx.draft, patente: ctx.draft.patente.trim().toUpperCase() }));
  },
  imprimirCarta: () => imprimir(docCarta({ ...ctx.draft, patente: ctx.draft.patente.trim().toUpperCase() })),

  /* presupuestos */
  nuevoPres: () => abrirPres(null),
  abrirPres: el => abrirPres(el.dataset.id),
  addItem: () => { ctx.draft.items.push({ desc: '', cant: '1', precio: 0 }); ctx.dirty = true; pintarPres(); setTimeout(() => { const i = $$('[data-f="desc"]'); i[i.length - 1]?.focus(); }, 30); },
  quitarItem: el => {
    ctx.draft.items.splice(+el.dataset.i, 1);
    if (!ctx.draft.items.length) ctx.draft.items.push({ desc: '', cant: '1', precio: 0 });
    ctx.dirty = true; pintarPres();
  },
  guardarPres: async () => {
    const era = ctx.draft.id;
    if (await guardarPres()) { await cerrarModal(true); render(); toast(era ? 'Presupuesto actualizado ✓' : 'Guardado en Presupuestos como «En espera». Cuando el cliente apruebe, el auto pasa a Autos ✓'); }
  },
  imprimirPres: () => imprimir(docPresupuesto(limpiarPres(clone(ctx.draft)))),
  imprimirFila: el => { const p = db.presupuestos.find(x => x.id === el.dataset.id); if (p) imprimir(docPresupuesto(p)); },
  eliminarPres: async () => {
    if (ctx.draft.autoId && db.autos.some(a => a.id === ctx.draft.autoId)) { toast('No se puede eliminar: el auto de este presupuesto sigue en el taller. Elimina primero el auto.', true); return; }
    if (!(await confirmar({ titulo: '¿Eliminar este presupuesto?', texto: 'No se puede deshacer. El auto (si ya está en el taller) no se borra.', ok: 'Sí, eliminar', cancelar: 'No', peligro: true }))) return;
    db.presupuestos = db.presupuestos.filter(x => x.id !== ctx.draft.id);
    db.autos.forEach(a => { if (a.presupuestoId === ctx.draft.id) a.presupuestoId = null; });
    await guardar(); await cerrarModal(true); render(); toast('Presupuesto eliminado');
  },
  filtroPres: el => { ui.pf = el.dataset.v; refrescarListaPres(); },
  aprobarPres: async () => {
    const p = limpiarPres(ctx.draft);
    if (!p.patente) { toast('Para ingresar el auto al taller falta la patente', true); $('[data-f="patente"]')?.focus(); return; }
    if (!p.marca.trim()) { toast('Falta la marca del auto', true); $('[data-f="marca"]')?.focus(); return; }
    if (!p.items.length) { toast('Agrega al menos una línea con el trabajo y su precio', true); return; }
    let auto = p.autoId && db.autos.find(a => a.id === p.autoId);
    if (!auto) {
      const existente = db.autos.find(a => !a.retirado && a.patente === p.patente);
      if (existente) {
        if (!(await confirmar({ titulo: 'Esta patente ya está en el taller', texto: `El auto ${p.patente} ya figura dentro. ¿Ligar este presupuesto a ese auto y actualizar su total?`, ok: 'Sí, ligar', cancelar: 'No' }))) return;
        auto = existente;
      }
    }
    if (!auto) {
      auto = {
        ...nuevoAutoVacio(), id: uid(), patente: p.patente, marca: p.marca, modelo: p.modelo, anio: p.anio,
        cliente: p.cliente, telefono: p.telefono, trabajo: p.items.map(i => i.desc.trim()).filter(Boolean).join(', '),
        estado: 'pendiente'
      };
      db.autos.push(auto);
    }
    p.autoId = auto.id;
    p.estado = 'aprobado';
    ctx.draft = p;
    if (await guardarPres()) { await cerrarModal(true); render(); toast('Presupuesto aprobado: el auto quedó en el taller como «Pendiente» ✓'); }
  },
  rechazarPres: async () => {
    const p = limpiarPres(ctx.draft);
    if (!p.items.length) { toast('Agrega al menos una línea con el trabajo y su precio', true); return; }
    if (!(await confirmar({ titulo: '¿El cliente rechazó el presupuesto?', texto: 'Queda guardado como «Rechazado» en Presupuestos. El auto no entra al taller.', ok: 'Sí, rechazado', cancelar: 'No' }))) return;
    p.estado = 'rechazado';
    ctx.draft = p;
    if (await guardarPres()) { await cerrarModal(true); render(); toast('Presupuesto marcado como rechazado'); }
  },
  reabrirPres: () => { ctx.draft.estado = 'espera'; ctx.dirty = true; pintarPres(); },

  /* ventas */
  setModo: el => { ui.modo = el.dataset.v; render(); },
  mover: el => { ui.ref = mover(ui.modo, ui.ref, +el.dataset.n); render(); },
  hoyPeriodo: () => { ui.ref = new Date(); render(); },
  irPeriodo: el => { ui.ref = parseISO(el.dataset.ref); render(); },
  imprimirInforme: () => imprimir(docInforme()),

  /* taller */
  guardarTaller: async () => {
    const g = id => $(id).value.trim();
    Object.assign(db.taller, {
      nombre: g('#t-nom') || TALLER_DEF.nombre, direccion: g('#t-dir'), telefono: g('#t-tel'), email: g('#t-mail'),
      mecanico: g('#t-mec'), apiKey: g('#t-api'), validez: num($('#t-val').value) || 15, pie: g('#t-pie'), ...($('#t-av') ? { aviso42: g('#t-av') } : {})
    });
    if (await guardar()) { render(); toast('Datos del taller guardados ✓'); }
  },
  respaldar: async () => {
    const json = JSON.stringify(db, null, 1), api = API();
    try {
      if (api) { const r = await api.exportar(json); if (r) toast('Copia guardada en: ' + r); }
      else { descargar(`respaldo-garage-${hoy()}.json`, json); toast('Copia descargada ✓'); }
    } catch (e) { toast('No se pudo guardar la copia: ' + (e.message || e), true); }
  },
  restaurar: async () => {
    const api = API();
    let raw;
    try {
      raw = api ? await api.importar() : await new Promise(res => {
        const f = $('#fileIn'); f.value = '';
        f.onchange = () => { const file = f.files[0]; if (!file) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(file); };
        f.click();
      });
    } catch (e) { toast('No se pudo abrir el archivo', true); return; }
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.autos)) { toast('Ese archivo no es una copia de seguridad válida', true); return; }
    if (!(await confirmar({ titulo: '¿Restaurar esta copia?', texto: `La copia tiene ${data.autos.length} auto(s). Reemplaza TODOS los datos actuales (antes se guarda una copia de lo que hay ahora).`, ok: 'Sí, restaurar', cancelar: 'No', peligro: true }))) return;
    if (api) await api.respaldo_previo();
    db = normalizar(data);
    bloqueado = false;
    await guardar(); render(); toast('Copia restaurada ✓');
  },
  abrirCarpeta: () => API()?.abrir_carpeta()
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACT[el.dataset.act]) return;
  ACT[el.dataset.act](el, e);
  if (ctx && ctx.dirty) programarBorrador();
});

/* ---- escritura en formularios ---- */
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'buscar') { ui.buscar = t.value; pintarAutos(); return; }
  if (t.id === 'buscarPres') { ui.bq = t.value; refrescarListaPres(); return; }
  if (t.classList.contains('money')) formatearDinero(t);
  if (!ctx || !t.dataset.f) return;
  if (ctx.tipo === 'paso') { // primer paso de «Ingresar auto»: solo la patente
    const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v !== t.value) t.value = v;
    ctx.draft.patente = v;
    clearTimeout(patT);
    if (v.length === 6) patT = setTimeout(() => pasoContinuar(), 500);
    return;
  }
  const f = t.dataset.f;
  let v = t.type === 'checkbox' ? t.checked : t.value;
  if (t.classList.contains('money')) v = num(t.value);
  else if (f === 'patente') { v = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (v !== t.value) t.value = v; }
  else if (f === 'anio') { v = v.replace(/\D/g, '').slice(0, 4); if (v !== t.value) t.value = v; }
  ctx.dirty = true;
  if (t.dataset.i !== undefined) ctx.draft.items[+t.dataset.i][f] = v;
  else ctx.draft[f] = v;
  if (f === 'marca' || f === 'modelo' || f === 'anio') ctx.autoFill = false; // ya lo escribió la persona
  if (f === 'patente' && (ctx.tipo === 'auto' || ctx.tipo === 'pres')) {
    clearTimeout(patT); patSeq++;
    if (v.length === 6) patT = setTimeout(() => buscarPatente(), 500);
    else { patUltima = ''; estadoPat(''); }
  }
  programarBorrador();
  if (ctx.tipo === 'auto' && f === 'total') $('#resumen').innerHTML = htmlResumen(ctx.draft);
  if (ctx.tipo === 'pres' && (t.dataset.i !== undefined || f === 'iva')) pintarTotalesPres();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && ctx && ctx.tipo === 'paso' && e.target.id === 'f-pat0') { clearTimeout(patT); pasoContinuar(); return; }
  if (e.key !== 'Escape') return;
  if (!$('#dialog').hidden) { $('#dialog [data-r="0"]')?.click(); return; }
  if (!$('#modal').hidden) cerrarModal();
});

/* =====================================================================
   Pantalla principal
   ===================================================================== */
function render() {
  const vista = ui.vista || 'autos';
  $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.v === vista));
  const t = db.taller;
  $('#nombreTaller').textContent = t.nombre;
  document.title = t.nombre;
  $('#sidePie').innerHTML = [t.mecanico && `Mecánico: <b>${esc(t.mecanico)}</b>`, t.telefono && `Tel: <b>${esc(t.telefono)}</b>`, t.direccion && esc(t.direccion)].filter(Boolean).join('<br>');
  const main = $('#main');
  const html = { autos: vistaAutos, presupuestos: vistaPres, ventas: vistaVentas, taller: vistaTaller }[vista]();
  const sc = main.scrollTop;
  main.innerHTML = html;
  main.scrollTop = ui.ultimaVista === vista ? sc : 0;
  ui.ultimaVista = vista;
  if (vista === 'taller') API()?.ruta().then(r => { const el = $('#rutaDatos'); if (el) el.textContent = 'Los datos están en: ' + r; });
  if (vista === 'taller' && !API()) { const c = $('#btnCarpeta'); if (c) c.hidden = true; }
}

(async function iniciar() {
  await cargar();
  render();
  if (bloqueado) {
    await confirmar({ titulo: 'No se pudieron leer los datos', texto: 'No se pudo leer el archivo de datos. No se va a guardar nada para no pisarlo. Cierra el programa y vuelve a abrirlo; si sigue igual, ve a «Datos del taller» → «Restaurar una copia», o avísale a quien te instaló el programa.', ok: 'Entendido', cancelar: 'Cerrar' });
    return;
  } else if (migrado && !recuperado) {
    await guardar();
  } else if (recuperado) {
    await guardar();
    toast('El archivo estaba dañado: se recuperaron los datos desde la última copia ✓');
  }
  // Quedó un formulario a medio llenar de la vez anterior (se cerró el programa sin guardar).
  if (db.borrador) {
    const b = db.borrador;
    const quiere = await confirmar({ titulo: 'Quedó algo sin guardar', texto: `La última vez cerraste el programa con ${b.tipo === 'auto' ? 'un auto' : 'un presupuesto'} a medio llenar${b.draft.patente ? ' (' + b.draft.patente + ')' : ''}. ¿Quieres seguir donde quedaste?`, ok: 'Sí, recuperarlo', cancelar: 'Descartarlo', enfocarOk: true });
    if (quiere) {
      reiniciarPatente();
      ctx = { tipo: b.tipo, draft: b.draft, origen: b.origen || null, dirty: true };
      if (b.tipo === 'auto') pintarAuto(); else pintarPres();
    } else {
      db.borrador = null;
      await guardar();
    }
  }
})();

})();
