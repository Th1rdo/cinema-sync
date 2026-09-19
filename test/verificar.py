# -*- coding: utf-8 -*-
"""Integridade do módulo: caminhos do module.json, imports, ações sem handler e i18n faltando."""
import json, re, os, sys

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
falhas = []

mod = json.load(open("module.json", encoding="utf-8"))
for campo in ("esmodules", "styles"):
    for c in mod.get(campo, []):
        if not os.path.exists(c): falhas.append(f"module.json aponta para {c}, inexistente")
for l in mod.get("languages", []):
    if not os.path.exists(l["path"]): falhas.append(f"idioma ausente: {l['path']}")

for arq in os.listdir("scripts"):
    for imp in re.findall(r'from "\./([^"]+)"', open(f"scripts/{arq}", encoding="utf-8").read()):
        if not os.path.exists(f"scripts/{imp}"): falhas.append(f"{arq} importa {imp}, inexistente")

for arq in os.listdir("scripts"):
    for t in re.findall(r'template: `modules/[^/]+/([^`]+)`', open(f"scripts/{arq}", encoding="utf-8").read()):
        if not os.path.exists(t): falhas.append(f"{arq}: PARTS aponta para {t}, inexistente")
js = open("scripts/director.js", encoding="utf-8").read()

hbs = open("templates/director.hbs", encoding="utf-8").read()
acoes_tpl = set(re.findall(r'data-action="(\w+)"', hbs))
bloco = js[js.index("actions: {"):js.index("};", js.index("actions: {"))]
acoes_js = {a for a in re.findall(r'^\s*(\w+):', bloco, re.M)} - {"actions"}
falhas += [f'botão data-action="{a}" sem handler' for a in acoes_tpl - acoes_js]
falhas += [f'ação "{a}" registrada mas sem botão' for a in acoes_js - acoes_tpl]

pt = json.load(open("lang/pt-BR.json", encoding="utf-8"))
en = json.load(open("lang/en.json", encoding="utf-8"))
usadas = set()
for arq in [f"scripts/{a}" for a in os.listdir("scripts")] + [f"templates/{t}" for t in os.listdir("templates")] + ["module.json"]:
    src = open(arq, encoding="utf-8").read()
    usadas |= set(re.findall(r'localize\("([\w.]+)"\)', src))
    usadas |= set(re.findall(r"localize '([\w.]+)'", src))
    usadas |= set(re.findall(r'"(CINEMA\.[\w.]+)"', src))
usadas |= {f"CINEMA.Fase.{v}" for v in re.findall(r'^\s+[A-Z]+:\s+"(\w+)",?\s*(?://.*)?$',
           open("scripts/const.js", encoding="utf-8").read()[
               open("scripts/const.js", encoding="utf-8").read().index("PHASE = {"):], re.M)}
for k in sorted(usadas):
    if k not in pt: falhas.append(f"chave {k} ausente em pt-BR")
    if k not in en: falhas.append(f"chave {k} ausente em en")
if set(pt) != set(en): falhas.append("pt-BR e en têm conjuntos de chaves diferentes")

print("\n".join(f"  ✖ {f}" for f in falhas) if falhas else "  ✓ integridade ok")
sys.exit(1 if falhas else 0)
