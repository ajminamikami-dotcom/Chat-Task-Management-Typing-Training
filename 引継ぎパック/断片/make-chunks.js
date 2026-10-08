// 本体 HTML を「AI に貼るための読み取り専用コピー」に切り出す。本体は一切変更しない。
//   node 引継ぎパック/断片/make-chunks.js          … 断片を作り直す
//   node 引継ぎパック/断片/make-chunks.js --check  … 断片が本体と一致しているか確かめる（古ければ 1 で終了）
// 切り出しは行番号ではなく目印（関数名・マーカー）で行うので、本体の行がずれても追従する。
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const APP = path.join(ROOT, "チャットタスク管理_タイピングトレーニング.html");
const OUT = __dirname;
const MAX_BYTES = 26000;   // 無料版の AI でも 1 回で貼れる目安

const lines = fs.readFileSync(APP, "utf8").split("\n");
const find = (re, from = 0) => {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  throw new Error("目印が見つかりません: " + re);
};
// [名前, 開始行の目印, 終了の目印（この行の直前まで。null なら次の区画の開始まで）, 種類, 説明]
const PLAN = [
  ["01_CSS（見た目）", /^<style>/, /^<\/style>/, "css", "色・大きさ・配置。『ゆったり表示』は body.comfortable の指定"],
  ["02_開始画面HTML", /^<body>/, /<section id="game-screen"/, "html", "開始画面（レベル・時間・表示の設定、判定基準パネル、ロゴ）"],
  ["03_ゲーム画面・結果画面・着信・停止HTML", /<section id="game-screen"/, /^<script>/, "html", "受信トレイ・チャット表示・操作パネルの枠、結果画面、着信画面、一時停止画面"],
  ["04_問題データ", /^<script>/, /^  const els = \{/, "js", "LEVEL1_DATA（Level 1 の 11 問）、TYPING_DATA（Level 2/3 の 20 問）、PHONE_DATA（電話 6 件）"],
  ["05_els（画面部品の参照）", /^  const els = \{/, /^  \/\* @@LOGIC_BEGIN/, "js", "id → 要素の対応表"],
  ["06_Logic（判定・集計・結果文・CSV）", /^  \/\* @@LOGIC_BEGIN/, /^  \/\* @@LOGIC_END \*\//, "js", "判定・正答率・助言文・CSV・入力一致の規則はここだけ（仕様書 dev-tests/spec と 1 対 1）"],
  ["07_state・初期化・キー操作", /^  \/\* @@LOGIC_END \*\//, /^  \/\/ ---- 操作の門番/, "js", "state（進行状態）、init、bindEvents（ボタン・キーボード・Tab の閉じ込め）、フォーカス移動"],
  ["08_門番・設定・ゲーム開始・新着と着信の予約", /^  \/\/ ---- 操作の門番/, /^  function renderAll\(/, "js", "操作の門番（ダブルクリック対策）、設定の保存、startGame、createChat、新着・着信の間隔、時計"],
  ["09_描画（受信トレイ・チャット・パネル）", /^  function renderAll\(/, /^  function finishChat\(/, "js", "受信トレイ、チャット本文、優先度パネル、返信パネル（入力・選択肢）、処理済パネル"],
  ["10_完了・着信・一時停止", /^  function finishChat\(/, /^  function endGame\(/, "js", "finishChat（完了の記録）、showPhone/handlePhone（着信）、togglePause（一時停止・再開）"],
  ["11_終了・結果画面・CSV・補助関数", /^  function endGame\(/, /^<\/script>/, "js", "endGame、showResults、要確認表、CSV ダウンロード、小さな補助関数"],
];

// 埋め込み画像（base64）は貼っても意味がないので、長さだけ残して省略する
const abbreviate = (text) => text.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+\/=]+/g, (m) => `data:image/…;base64,【画像データ ${m.length} 文字を省略】`);

function cut() {
  const chunks = [];
  for (let k = 0; k < PLAN.length; k++) {
    const [name, startRe, endRe, kind, desc] = PLAN[k];
    const start = find(startRe);
    const end = endRe ? find(endRe, start + 1) : lines.length;   // end は含まない
    const last = k === PLAN.length - 1 ? end + 1 : end;            // 最後の区画は </script> を含める
    chunks.push({ name, kind, desc, start, end: last });
  }
  // 大きすぎる区画は、真ん中に近い空行で分ける（a, b, …）
  const out = [];
  for (const c of chunks) {
    const parts = split(c.start, c.end);
    parts.forEach((p, i) => out.push({ ...c, start: p[0], end: p[1], suffix: parts.length > 1 ? String.fromCharCode(97 + i) : "" }));
  }
  return out;
}
function split(start, end) {
  const bytes = Buffer.byteLength(abbreviate(lines.slice(start, end).join("\n")), "utf8");
  if (bytes <= MAX_BYTES || end - start < 40) return [[start, end]];
  const mid = Math.floor((start + end) / 2);
  let at = -1;
  for (let d = 0; d < (end - start) / 2; d++) {
    if (mid + d < end && lines[mid + d].trim() === "") { at = mid + d; break; }
    if (mid - d > start && lines[mid - d].trim() === "") { at = mid - d; break; }
  }
  if (at < 0) at = mid;
  return [...split(start, at), ...split(at, end)];
}
function header(c, total) {
  const text = `読み取り専用コピー（本体から機械的に切り出したもの。ここを編集しても本体は変わりません。埋め込み画像の base64 は省略）
本体: チャットタスク管理_タイピングトレーニング.html  行 ${c.start + 1}〜${c.end}（全 ${total} 行）
区画: ${c.name}${c.suffix ? "（" + c.suffix + "）" : ""} … ${c.desc}
作り直し: node 引継ぎパック/断片/make-chunks.js   一致の確認: 同じコマンドに --check`;
  if (c.kind === "html") return `<!-- =====\n${text}\n===== -->\n`;
  return `/* =====\n${text}\n===== */\n`;
}
function fileName(c) {
  const ext = c.kind === "css" ? "css" : c.kind === "html" ? "html" : "js";
  return `${c.name}${c.suffix}.${ext}.txt`;
}
function render(c) { return header(c, lines.length) + abbreviate(lines.slice(c.start, c.end).join("\n")) + "\n"; }
function toc(chunks) {
  const rows = chunks.map((c) => `| ${fileName(c)} | ${c.start + 1}〜${c.end} | ${(Buffer.byteLength(render(c), "utf8") / 1024).toFixed(1)} KB | ${c.desc} |`);
  return `# 断片の目次（本体の読み取り専用コピー）

本体 \`チャットタスク管理_タイピングトレーニング.html\`（全 ${lines.length} 行）を、AI ツールに 1 回で貼れる大きさに切り出したものです。
**本体はこの 1 ファイルのまま変えません。断片を編集しても本体には反映されません。** 変更は必ず本体に対して行い、変更後に \`node 引継ぎパック/断片/make-chunks.js\` で断片を作り直してください（\`--check\` で一致を確認できます）。

どれを貼るかは \`04_よくある作業の手順\` の各作業に書いてあります。迷ったら: 文言・問題 → 04、判定・助言・CSV → 06、画面の動き → 08〜10、見た目 → 01。

| ファイル | 本体の行 | 大きさ | 内容 |
|---|---|---|---|
${rows.join("\n")}

目安: 無料版の AI には 1 回に 1〜2 ファイルまで。貼る前に \`引継ぎパック/06_無料版AIでの作業ガイド.md\` の「最初に貼る説明文」を貼ってください。
`;
}

const chunks = cut();
const files = new Map(chunks.map((c) => [fileName(c), render(c)]));
files.set("00_目次.md", toc(chunks));
const check = process.argv.includes("--check");
let stale = [];
for (const [name, body] of files) {
  const p = path.join(OUT, name);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (cur !== body) stale.push(name);
  if (!check) fs.writeFileSync(p, body);
}
// 計画に無い古い断片は消す（--check では報告だけ）
for (const f of fs.readdirSync(OUT)) {
  if (/\.(css|html|js)\.txt$/.test(f) && !files.has(f)) { stale.push(f + "（不要）"); if (!check) fs.unlinkSync(path.join(OUT, f)); }
}
if (check) {
  if (stale.length) { console.log("断片が本体と一致していません（作り直してください: node 引継ぎパック/断片/make-chunks.js）:\n  " + stale.join("\n  ")); process.exit(1); }
  console.log(`断片 ${files.size - 1} 件は本体と一致しています`);
} else {
  for (const c of chunks) console.log(`${fileName(c)}  行 ${c.start + 1}〜${c.end}  ${(Buffer.byteLength(render(c), "utf8") / 1024).toFixed(1)} KB`);
  console.log(`断片 ${files.size - 1} 件を書き出しました（${stale.length ? "更新 " + stale.length + " 件" : "変更なし"}）`);
}
