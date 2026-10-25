"""El Garage de Einstein - aplicación de escritorio para el taller.

Abre una ventana con la interfaz (carpeta web/) y guarda los datos en
Documentos\\Garage de Einstein - Datos\\datos.json, con copia diaria automática.
"""
import ctypes
import datetime
import json
import os
import shutil
import sys
from pathlib import Path

import webview

TITULO = "El Garage de Einstein"
BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def _documentos() -> Path:
    try:
        buf = ctypes.create_unicode_buffer(260)
        # 5 = CSIDL_PERSONAL (carpeta Documentos, incluso si está en OneDrive)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
            return Path(buf.value)
    except Exception:
        pass
    return Path.home() / "Documents"


CARPETA = _documentos() / "Garage de Einstein - Datos"
ARCHIVO = CARPETA / "datos.json"
RESPALDOS = CARPETA / "respaldos"


def _respaldo_diario() -> None:
    """Copia datos.json a respaldos/ una vez por día. Nunca se borra ninguna copia."""
    if not ARCHIVO.exists():
        return
    RESPALDOS.mkdir(parents=True, exist_ok=True)
    destino = RESPALDOS / f"datos-{datetime.date.today().isoformat()}.json"
    if not destino.exists():
        shutil.copy2(ARCHIVO, destino)


def _ruta_dialogo(resultado):
    if not resultado:
        return None
    return resultado if isinstance(resultado, str) else resultado[0]


class Api:
    """Métodos que la interfaz llama con window.pywebview.api.*"""

    def cargar(self):
        if ARCHIVO.exists():
            return ARCHIVO.read_text(encoding="utf-8")
        return None

    def ultimo_respaldo(self):
        """Contenido de la copia más reciente (para recuperarse si datos.json se dañó)."""
        copias = sorted(RESPALDOS.glob("*.json")) if RESPALDOS.exists() else []
        previo = CARPETA / "datos.anterior.json"
        if previo.exists():
            return previo.read_text(encoding="utf-8")
        return copias[-1].read_text(encoding="utf-8") if copias else None

    def guardar(self, texto):
        try:
            CARPETA.mkdir(parents=True, exist_ok=True)
            json.loads(texto)  # nunca escribir algo que no sea JSON válido
            if ARCHIVO.exists():  # deja la versión anterior como red de seguridad
                shutil.copy2(ARCHIVO, CARPETA / "datos.anterior.json")
            temporal = ARCHIVO.with_suffix(".tmp")
            temporal.write_text(texto, encoding="utf-8")
            os.replace(temporal, ARCHIVO)
            return {"ok": True}
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "error": str(error)}

    def ruta(self):
        return str(CARPETA)

    def abrir_carpeta(self):
        CARPETA.mkdir(parents=True, exist_ok=True)
        os.startfile(CARPETA)  # type: ignore[attr-defined]

    def exportar(self, texto):
        ventana = webview.windows[0]
        nombre = f"respaldo-garage-{datetime.date.today().isoformat()}.json"
        dialogo = getattr(getattr(webview, "FileDialog", None), "SAVE", None) or webview.SAVE_DIALOG
        ruta = _ruta_dialogo(ventana.create_file_dialog(
            dialogo, directory=str(_documentos()), save_filename=nombre,
            file_types=("Copia de seguridad (*.json)",)))
        if not ruta:
            return None
        Path(ruta).write_text(texto, encoding="utf-8")
        return ruta

    def importar(self):
        ventana = webview.windows[0]
        dialogo = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
        ruta = _ruta_dialogo(ventana.create_file_dialog(
            dialogo, directory=str(_documentos()),
            file_types=("Copia de seguridad (*.json)",)))
        if not ruta:
            return None
        return Path(ruta).read_text(encoding="utf-8")

    def respaldo_previo(self):
        """Guarda el estado actual antes de restaurar una copia."""
        if ARCHIVO.exists():
            RESPALDOS.mkdir(parents=True, exist_ok=True)
            marca = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
            shutil.copy2(ARCHIVO, RESPALDOS / f"antes-de-restaurar-{marca}.json")
        return True


def main():
    CARPETA.mkdir(parents=True, exist_ok=True)
    try:
        _respaldo_diario()
    except Exception:
        pass
    webview.create_window(
        TITULO,
        url=str(BASE / "web" / "index.html"),
        js_api=Api(),
        width=1360,
        height=840,
        min_size=(1000, 640),
        maximized=True,
    )
    webview.start()


if __name__ == "__main__":
    main()
