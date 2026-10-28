"""El Garage de Einstein: ventana (pywebview) + guardado de datos en archivos.

La interfaz vive en la carpeta web (index.html, style.css, app.js).
Los datos se guardan en  Documentos/Garage de Einstein - Datos/datos.json
"""
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import webview

NOMBRE = "El Garage de Einstein"
CARPETA_DATOS = "Garage de Einstein - Datos"
MAX_RESPALDOS = 30


def recurso(*partes):
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base.joinpath(*partes)


def carpeta_datos():
    docs = Path.home() / "Documents"
    if not docs.exists():
        docs = Path.home()
    d = docs / CARPETA_DATOS
    (d / "respaldos").mkdir(parents=True, exist_ok=True)
    return d


def _cuenta(texto):
    """Cantidad de autos + presupuestos de un JSON (para no pisar datos con una base vacía)."""
    try:
        d = json.loads(texto)
        return len(d.get("autos", [])) + len(d.get("presupuestos", []))
    except Exception:
        return 0


def _escribir_atomico(ruta, texto):
    """Escribe en un archivo temporal, lo fuerza a disco y recién ahí reemplaza el original."""
    tmp = ruta.with_suffix(ruta.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(texto)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, ruta)


class Api:
    def __init__(self):
        self._dir = carpeta_datos()
        self._archivo = self._dir / "datos.json"
        self._anterior = self._dir / "datos.anterior.json"
        self._respaldos = self._dir / "respaldos"
        self._ventana = None

    # ---------- datos ----------
    def cargar(self):
        """Devuelve el texto del archivo, o '' si todavía no existe (primer uso).
        Si no se puede leer, lanza error: la interfaz NO debe arrancar vacía."""
        if not self._archivo.exists():
            return ""
        with open(self._archivo, "r", encoding="utf-8-sig") as f:
            return f.read()

    def guardar(self, texto):
        try:
            json.loads(texto)  # nunca guardar algo que no sea JSON válido
            previo = None
            if self._archivo.exists():
                with open(self._archivo, "r", encoding="utf-8-sig") as f:
                    previo = f.read()
            if previo is not None:
                # Si la base nueva viene vacía pero la que hay no lo está, se conserva una copia aparte.
                if _cuenta(previo) > 0 and _cuenta(texto) == 0:
                    self._copiar_texto(previo, "antes-de-vaciar")
                if previo != texto:
                    _escribir_atomico(self._anterior, previo)
                # Copia del día: el estado con que empezó el día.
                hoy = self._respaldos / f"datos-{datetime.now():%Y-%m-%d}.json"
                if not hoy.exists():
                    _escribir_atomico(hoy, previo)
                    self._podar()
            _escribir_atomico(self._archivo, texto)
            return {"ok": True}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}

    def _copiar_texto(self, texto, prefijo):
        _escribir_atomico(self._respaldos / f"{prefijo}-{datetime.now():%Y-%m-%d_%H%M%S}.json", texto)

    def _podar(self):
        diarios = sorted(self._respaldos.glob("datos-*.json"))
        for viejo in diarios[:-MAX_RESPALDOS]:
            try:
                viejo.unlink()
            except OSError:
                pass

    def ultimo_respaldo(self):
        candidatos = []
        for p in [self._anterior, *self._respaldos.glob("*.json")]:
            if p.exists():
                candidatos.append((p.stat().st_mtime, p))
        for _, p in sorted(candidatos, reverse=True):
            try:
                with open(p, "r", encoding="utf-8-sig") as f:
                    t = f.read()
                json.loads(t)
                return t
            except Exception:  # noqa: BLE001
                continue
        return None

    def respaldo_previo(self):
        if self._archivo.exists():
            with open(self._archivo, "r", encoding="utf-8-sig") as f:
                self._copiar_texto(f.read(), "antes-de-restaurar")
        return True

    def ruta(self):
        return str(self._dir)

    def abrir_carpeta(self):
        os.startfile(str(self._dir))

    def exportar(self, texto):
        dlg = getattr(webview, "FileDialog", None)
        tipo = dlg.SAVE if dlg else webview.SAVE_DIALOG
        r = self._ventana.create_file_dialog(
            tipo, directory=str(Path.home() / "Documents"),
            save_filename=f"respaldo-garage-{datetime.now():%Y-%m-%d}.json",
            file_types=("Copia de seguridad (*.json)",))
        if not r:
            return None
        destino = r if isinstance(r, str) else r[0]
        _escribir_atomico(Path(destino), texto)
        return str(destino)

    def importar(self):
        dlg = getattr(webview, "FileDialog", None)
        tipo = dlg.OPEN if dlg else webview.OPEN_DIALOG
        r = self._ventana.create_file_dialog(
            tipo, directory=str(Path.home() / "Documents"), allow_multiple=False,
            file_types=("Copia de seguridad (*.json)",))
        if not r:
            return None
        with open(r[0], "r", encoding="utf-8-sig") as f:
            return f.read()

    # ---------- consulta de patente (Boostr.cl) ----------
    def consultar_patente(self, patente, clave):
        """Busca marca, modelo y año de una patente chilena. Nunca lanza error: devuelve {ok, ...}."""
        patente = "".join(c for c in str(patente).upper() if c.isalnum())
        clave = (clave or "").strip()
        if not clave:
            return {"ok": False, "motivo": "sin_clave"}
        req = urllib.request.Request(
            f"https://api.boostr.cl/vehicle/{patente}.json",
            headers={"X-API-KEY": clave, "accept": "application/json", "User-Agent": "GarageEinstein/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                cuerpo = json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            motivo = {401: "clave", 403: "clave", 404: "no_encontrada", 429: "limite"}.get(e.code, "error")
            return {"ok": False, "motivo": motivo, "detalle": f"HTTP {e.code}"}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "motivo": "red", "detalle": str(e)}
        datos = cuerpo.get("data", cuerpo) if isinstance(cuerpo, dict) else {}
        marca = str(datos.get("make") or datos.get("marca") or "").strip()
        modelo = str(datos.get("model") or datos.get("modelo") or "").strip()
        anio = str(datos.get("year") or datos.get("anio") or datos.get("año") or "").strip()
        if not (marca or modelo or anio):
            return {"ok": False, "motivo": "no_encontrada"}
        return {"ok": True, "marca": marca, "modelo": modelo, "anio": anio}


def main():
    api = Api()
    ventana = webview.create_window(
        NOMBRE, str(recurso("web", "index.html")), js_api=api,
        width=1280, height=820, min_size=(980, 640))
    api._ventana = ventana
    webview.start(http_server=True)


if __name__ == "__main__":
    main()
