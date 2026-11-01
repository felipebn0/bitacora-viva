#!/usr/bin/env python3
"""Genera las tipografías TTF que usa el PDF del libro (public/eco-libro-pdf.js) a partir de las WOFF2 de public/fonts/files.
La librería de PDF del navegador no lee WOFF2, y Source Serif 4 viene como fuente variable: aquí se baja a TTF y se fijan los
pesos que se usan (400 normal e itálica, 600 para los títulos). Necesita: pip install fonttools brotli
Uso: python3 tools/generar-fuentes-pdf.py
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'fonts')
ORIGEN = os.path.join(RAIZ, 'files')
DESTINO = os.path.join(RAIZ, 'pdf')
os.makedirs(DESTINO, exist_ok=True)

def a_ttf(nombre_woff2, nombre_ttf, pesos=None):
    f = TTFont(os.path.join(ORIGEN, nombre_woff2))
    if pesos is not None:
        f = instancer.instantiateVariableFont(f, pesos, inplace=False)
    f.flavor = None
    f.save(os.path.join(DESTINO, nombre_ttf))
    print(nombre_ttf, os.path.getsize(os.path.join(DESTINO, nombre_ttf)) // 1024, 'KB')

a_ttf('source-serif-4-latin-standard-normal.woff2', 'source-serif-4-400.ttf', {'wght': 400})
a_ttf('source-serif-4-latin-standard-normal.woff2', 'source-serif-4-600.ttf', {'wght': 600})
a_ttf('source-serif-4-latin-standard-italic.woff2', 'source-serif-4-400-italic.ttf', {'wght': 400})
a_ttf('atkinson-hyperlegible-latin-400-normal.woff2', 'atkinson-hyperlegible-400.ttf')
a_ttf('atkinson-hyperlegible-latin-700-normal.woff2', 'atkinson-hyperlegible-700.ttf')
