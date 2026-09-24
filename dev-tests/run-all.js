// 恒久検査スイート 一括実行
//   node run-all.js            … 全スイート（約60分）。変異検査は別途 node mutate.js
//   QUICK=1 node run-all.js    … 長時間スイート（判定マトリクス・模擬プレイ・ゲームQA）を除く（約6分）
//   ONLY=e2e03,e2e07 node run-all.js
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SUITES = [
  ["e2e07_data",        "データ整合（正解表・判別可能性・規則表からの導出・一意性）", "fast"],
  ["diff-check",        "差分検査（本体 Logic × 参照実装2本、乱数 10,000 セッション）", "fast"],
  ["golden",            "ゴールデン回帰（固定入力 3,000 セッションの出力指紋）",     "fast"],
  ["e2e03_softlock",    "進行不能探索（無作為操作×解決可能性オラクル）",    "fast"],
  ["e2e05_adversarial", "敵対的（連打・二重起動・悪意入力・破損データ）",   "fast"],
  ["e2e06_symmetry",    "対称性スイープ",                                  "fast"],
  ["e2e10_audit",       "監査で確認した不具合の再発防止（一時停止・着信・入力表示・確認画面・CSV）", "fast"],
  ["e2e02_ideal",       "理想プレイ（最高評価の到達可能性）",              "long"],
  ["e2e04_gameqa",      "ゲームQA手法10種",                                "long"],
  ["e2e01_playthrough", "模擬プレイスルー（時間切れ経路を含む）",          "long"],
  ["e2e08_judgment",    "判定マトリクス総当たり（誤判定ゼロ）",            "long"],
  ["e2e09_humanpace",   "人間の速度でのプレイ（体感の理不尽さ・Enter送信・狭い画面の結果画面）", "long"],
];

const quick = !!process.env.QUICK;
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const results = [];
for (const [name, desc, kind] of SUITES) {
  if (quick && kind === "long") continue;
  if (only && !only.some((o) => name.startsWith(o))) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, name + ".js")], { stdio: "inherit", env: process.env });
  results.push({ name, desc, code: r.status, sec: Math.round((Date.now() - t0) / 1000) });
  console.log("");
}

console.log("\n==================== 検査結果 ====================");
for (const r of results) {
  let detail = "";
  try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, "_out", r.name + ".json"), "utf8")); detail = `${j.rows.filter((x) => x.ok).length}/${j.rows.length} OK, JSエラー ${j.errors.length}`; } catch (_) {}
  console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.name.padEnd(18)} ${String(r.sec).padStart(5)}秒  ${detail.padEnd(26)} ${r.desc}`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(failed.length ? `\n${failed.length} スイートが失敗` : "\n全スイート合格");
process.exit(failed.length ? 1 : 0);
