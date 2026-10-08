# -*- coding: utf-8 -*-
"""配布 ZIP を組み立てる（UTF-8 ファイル名フラグ付き。Windows の文字化け防止）。

使い方（リポジトリの直下で）:
    python 配布物/build_zip.py V6 "配布物/【V6 ○○】.txt"
      第1引数: 版の名前（フォルダ名と ZIP 名に使う）
      第2引数: 同梱する説明書（省略可。配布物/ にある【V…】.txt を指定）
出来上がり: 配布物/out/☆チャットタスク管理・タイピングトレーニング <版>.zip

同梱するもの（存在するものだけ）:
  本体 HTML／実施マニュアル（docx・pdf）／フライヤー PDF／説明書／dev-tests（node_modules・_out を除く）／引継ぎパック
"""
import os, sys, shutil, zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = "チャットタスク管理_タイピングトレーニング.html"
DIST_DIR = os.path.join(REPO, "配布物")

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    version = sys.argv[1]
    notes = sys.argv[2] if len(sys.argv) > 2 else None
    name = f"☆チャットタスク管理・タイピングトレーニング {version}"
    stage = os.path.join(DIST_DIR, "out", "_stage", name)
    shutil.rmtree(os.path.join(DIST_DIR, "out", "_stage"), ignore_errors=True)
    os.makedirs(stage)

    shutil.copy(os.path.join(REPO, APP), stage)
    for f in sorted(os.listdir(DIST_DIR)):
        if f.endswith((".docx", ".pdf")):
            shutil.copy(os.path.join(DIST_DIR, f), stage)
    if notes:
        shutil.copy(os.path.join(REPO, notes), stage)

    def copy_tree(src, dst, skip=("node_modules", "_out", "out", "__pycache__")):
        for root, dirs, files in os.walk(src):
            dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith("."))
            rel = os.path.relpath(root, src)
            os.makedirs(os.path.join(dst, rel), exist_ok=True)
            for f in sorted(files):
                if f.startswith("_") and f.endswith(".log"): continue
                shutil.copy(os.path.join(root, f), os.path.join(dst, rel, f))
    copy_tree(os.path.join(REPO, "dev-tests"), os.path.join(stage, "dev-tests"))
    if os.path.isdir(os.path.join(REPO, "引継ぎパック")):
        copy_tree(os.path.join(REPO, "引継ぎパック"), os.path.join(stage, "引継ぎパック"))

    out = os.path.join(DIST_DIR, "out", name + ".zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(stage):
            dirs.sort()
            for f in sorted(files):
                full = os.path.join(root, f)
                arc = os.path.relpath(full, os.path.dirname(stage))
                info = zipfile.ZipInfo.from_file(full, arc)
                info.flag_bits |= 0x800          # UTF-8 ファイル名
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(full, "rb") as fh:
                    z.writestr(info, fh.read())
    shutil.rmtree(os.path.join(DIST_DIR, "out", "_stage"))
    print(out, os.path.getsize(out), "bytes")
    for n in zipfile.ZipFile(out).namelist(): print("  ", n)

if __name__ == "__main__":
    main()
