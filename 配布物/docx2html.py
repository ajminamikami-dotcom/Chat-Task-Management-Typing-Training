# -*- coding: utf-8 -*-
"""docx（抽出済みフォルダ）→ 単一 HTML。見出し・箇条書き・表・画像・改ページを保ち、PDF 化は Chromium で行う。"""
import re, sys, os, base64, html
from xml.etree import ElementTree as ET
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
src, out = sys.argv[1], sys.argv[2]
root = ET.parse(os.path.join(src, 'word/document.xml')).getroot()
rels = ET.parse(os.path.join(src, 'word/_rels/document.xml.rels')).getroot()
media = {}
for rel in rels:
    if 'media/' in rel.get('Target', ''):
        p = os.path.join(src, 'word', rel.get('Target'))
        mime = 'image/png' if p.endswith('.png') else 'image/jpeg'
        media[rel.get('Id')] = f"data:{mime};base64," + base64.b64encode(open(p, 'rb').read()).decode()

def run_html(r):
    parts = []
    rPr = r.find(W + 'rPr')
    bold = rPr is not None and rPr.find(W + 'b') is not None and rPr.find(W + 'b').get(W + 'val') != '0'
    for el in r:
        if el.tag == W + 't': parts.append(html.escape(el.text or ''))
        elif el.tag == W + 'br': parts.append('<br>')
        elif el.tag == W + 'tab': parts.append('&emsp;')
        elif el.tag == W + 'drawing':
            for blip in el.iter(A + 'blip'):
                rid = blip.get(R + 'embed')
                if rid in media: parts.append(f'<img src="{media[rid]}">')
    s = ''.join(parts)
    return f'<strong>{s}</strong>' if bold and s.strip() else s

def para_html(p):
    pPr = p.find(W + 'pPr')
    style = None; num = False; pb = False; center = False
    if pPr is not None:
        st = pPr.find(W + 'pStyle'); style = st.get(W + 'val') if st is not None else None
        num = pPr.find(W + 'numPr') is not None
        jc = pPr.find(W + 'jc'); center = jc is not None and jc.get(W + 'val') == 'center'
    for br in p.iter(W + 'br'):
        if br.get(W + 'type') == 'page': pb = True
    inner = ''.join(run_html(r) for r in p.findall(W + 'r'))
    return style, num, pb, center, inner

out_parts = []; in_list = False
def close_list():
    global in_list
    if in_list: out_parts.append('</ul>'); in_list = False
body = root.find(W + 'body')
for el in body:
    if el.tag == W + 'p':
        style, num, pb, center, inner = para_html(el)
        if pb: close_list(); out_parts.append('<div class="pb"></div>')
        if not inner.strip(): continue
        if style == 'Heading1': close_list(); out_parts.append(f'<h1>{inner}</h1>')
        elif style == 'Heading2': close_list(); out_parts.append(f'<h2>{inner}</h2>')
        elif num:
            if not in_list: out_parts.append('<ul>'); in_list = True
            out_parts.append(f'<li>{inner}</li>')
        else:
            close_list(); cls = ' class="c"' if center else ''
            out_parts.append(f'<p{cls}>{inner}</p>')
    elif el.tag == W + 'tbl':
        close_list(); rows = []
        for i, tr in enumerate(el.findall(W + 'tr')):
            cells = []
            for tc in tr.findall(W + 'tc'):
                ps = [para_html(p)[4] for p in tc.findall(W + 'p')]
                cells.append(('<th>' if i == 0 else '<td>') + '<br>'.join(x for x in ps if x.strip()) + ('</th>' if i == 0 else '</td>'))
            rows.append('<tr>' + ''.join(cells) + '</tr>')
        out_parts.append('<table>' + ''.join(rows) + '</table>')
close_list()
css = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Noto Sans JP", "IPAPGothic", "IPAGothic", "Yu Gothic", "Meiryo", sans-serif; font-size: 10.5pt; line-height: 1.7; color: #172126; }
h1 { font-size: 15pt; border-left: 6px solid #1f6f8b; padding-left: 8px; margin: 22px 0 10px; }
h2 { font-size: 12.5pt; color: #1f6f8b; margin: 18px 0 8px; }
p { margin: 4px 0; } p.c { text-align: center; }
ul { margin: 4px 0 8px 22px; padding: 0; } li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9.5pt; }
th, td { border: 1px solid #b9c4c9; padding: 5px 7px; vertical-align: top; text-align: left; }
td:first-child, th:first-child { white-space: nowrap; }
th { background: #eef4f7; }
img { max-width: 100%; height: auto; display: block; margin: 6px auto; }
.pb { page-break-after: always; }
"""
open(out, 'w', encoding='utf-8').write(f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>{css}</style></head><body>{"".join(out_parts)}</body></html>')
print('html written', out, len(out_parts), 'blocks')
