@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Creando El Garage de Einstein.exe ...
python -m pip install --quiet pywebview pyinstaller
python -m PyInstaller --noconfirm --clean --onefile --noconsole --name "El Garage de Einstein" --icon icon.ico --add-data "web;web" main.py
echo.
echo Listo. El programa quedo en la carpeta "dist".
pause
