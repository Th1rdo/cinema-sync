# -*- coding: utf-8 -*-
"""Integridade do módulo: caminhos, imports, templates, ações sem handler, i18n faltando."""
import json, re, os, sys

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
falhas = []
ler = lambda p: open(p, encoding="utf-8").read()

mod = json.load(open("module.json", encoding="utf-8"))
for campo in ("esmodules", "styles"):
    for c in mod.get(campo, []):
        if not os.path.exists(c): falhas.append(f"module.json aponta para {c}, inexistente")
for l in mod.get("languages", []):
    if not os.path.exists(l["path"]): falhas.append(f"idioma ausente: {l['path']}")

scripts = {a: ler(f"scripts/{a}") for a in os.listdir("scripts") if a.endswith(".js")}
templates = {t: ler(f"templates/{t}") for t in os.listdir("templates")}

for arq, src in scripts.items():
    for imp in re.findall(r'from "\./([^"]+)"', src):
        if imp not in scripts: falhas.append(f"{arq} importa {imp}, inexistente")
    for t in re.findall(r'template: `modules/[^/]+/([^`]+)`', src):
        if not os.path.exists(t): falhas.append(f"{arq}: PARTS aponta para {t}, inexistente")
    for asset in re.findall(r'modules/\$\{MODULE_ID\}/(assets/[\w.-]+)', src):
        if not os.path.exists(asset): falhas.append(f"{arq} usa {asset}, inexistente")
for t, src in templates.items():
    for asset in re.findall(r'modules/cinema-sync/(assets/[\w.-]+)', src):
        if not os.path.exists(asset): falhas.append(f"{t} usa {asset}, inexistente")

# data-action dos templates × actions registradas nos apps
acoes_tpl = {a for src in templates.values() for a in re.findall(r'data-action="(\w+)"', src)}
acoes_js = set()
for src in scripts.values():
    if "actions: {" not in src: continue
    bloco = src[src.index("actions: {"):src.index("}", src.index("actions: {"))]
    acoes_js |= {a for a in re.findall(r'^\s*(\w+):', bloco, re.M)} - {"actions"}
falhas += [f'botão data-action="{a}" sem handler' for a in sorted(acoes_tpl - acoes_js)]
falhas += [f'ação "{a}" registrada mas sem botão' for a in sorted(acoes_js - acoes_tpl)]

# i18n: toda chave CINEMA.* usada existe nos dois idiomas
pt = json.load(open("lang/pt-BR.json", encoding="utf-8"))
en = json.load(open("lang/en.json", encoding="utf-8"))
usadas = set()
for src in list(scripts.values()) + list(templates.values()) + [ler("module.json")]:
    usadas |= set(re.findall(r'(CINEMA\.[A-Za-z][\w.]*[A-Za-z])', src))
bloco_fases = ler("scripts/const.js")
bloco_fases = bloco_fases[bloco_fases.index("PHASE = {"):bloco_fases.index("};", bloco_fases.index("PHASE = {"))]
usadas |= {f"CINEMA.Fase.{v}" for v in re.findall(r':\s*"(\w+)"', bloco_fases)}
usadas.discard("CINEMA.Fase")          # prefixo montado dinamicamente
for k in sorted(usadas):
    if k not in pt: falhas.append(f"chave {k} ausente em pt-BR")
    if k not in en: falhas.append(f"chave {k} ausente em en")
if set(pt) != set(en): falhas.append("pt-BR e en têm conjuntos de chaves diferentes")
sobrando = sorted(set(pt) - usadas)

print("\n".join(f"  ✖ {f}" for f in falhas) if falhas else "  ✓ integridade ok")
if sobrando: print("  · chaves declaradas e não usadas:", ", ".join(sobrando))
sys.exit(1 if falhas else 0)
