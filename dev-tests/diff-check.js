// diff-check.js 差分検査（⑥）
//   本体 HTML の Logic ブロック（判定・集計・表示文・CSV・入力一致）を切り出して Node で動かし、
//   仕様書（spec/judgment-spec.md）だけから書かれた参照実装（ref/ref-*.js）と、乱数入力で全出力を突き合わせる。
//   node diff-check.js            … 10,000 セッション（既定 seed）
//   N=3000 SEED=7 node diff-check.js
//   APP=path/to/app.html          … 対象を差し替え（変異検査が使う）
//   JSON=1                        … 結果を JSON 1 行で出力（変異検査が使う）
"use strict";
const fs = require("fs");
const path = require("path");
const { loadLogic, makeRng, genSession, genTypingCases, outputsOf } = require("./_logic-lib");

const N = Number(process.env.N || 10000);
const SEED = Number(process.env.SEED || 20260924);
const JSON_OUT = !!process.env.JSON;

const app = loadLogic();
const refDir = path.join(__dirname, "ref");
const refs = fs.existsSync(refDir)
  ? fs.readdirSync(refDir).filter((f) => /^ref-.*\.js$/.test(f)).map((f) => ({ name: f, impl: require(path.join(refDir, f)) }))
  : [];
if (!refs.length) { console.error("参照実装（dev-tests/ref/ref-*.js）がありません"); process.exit(2); }

const rng = makeRng(SEED);
const mismatches = [];
let compared = 0, sessions = 0, typingCases = 0;

function diffOutputs(label, a, b, inputSummary) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const sa = JSON.stringify(a[key]), sb = JSON.stringify(b[key]);
    compared += 1;
    if (sa !== sb) mismatches.push({ ref: label, key, app: sa, ref_value: sb, input: inputSummary });
  }
}

for (let i = 0; i < N; i++) {
  const session = genSession(rng, i);
  sessions += 1;
  const appOut = outputsOf(app, session);
  for (const ref of refs) {
    const refOut = outputsOf(ref.impl, session);
    diffOutputs(ref.name, appOut, refOut, { session: i, level: session.level, endReason: session.endReason, chats: session.chats.length });
  }
  // 入力一致（typingProgress / targetMarks）はセッションとは別に、お手本ごとの改変パターンで検査
  for (const c of genTypingCases(rng, session)) {
    typingCases += 1;
    const a = { progress: app.typingProgress(c.draft, c.reply), marks: app.targetMarks(c.draft, c.reply) };
    for (const ref of refs) {
      const b = { progress: ref.impl.typingProgress(c.draft, c.reply), marks: ref.impl.targetMarks(c.draft, c.reply) };
      diffOutputs(ref.name, a, b, { session: i, draft: c.draft, reply: c.reply, kind: c.kind });
    }
  }
}

const summary = { sessions, typingCases, compared, refs: refs.map((r) => r.name), mismatches: mismatches.length };
if (JSON_OUT) {
  console.log(JSON.stringify({ ...summary, first: mismatches.slice(0, 3) }));
} else {
  console.log(`差分検査: セッション ${sessions} 件 / 入力一致ケース ${typingCases} 件 / 比較 ${compared} 項目 / 参照実装 ${refs.map((r) => r.name).join(", ")}`);
  if (mismatches.length) {
    console.log(`不一致 ${mismatches.length} 件。先頭 10 件:`);
    for (const m of mismatches.slice(0, 10)) console.log(`  [${m.ref}] ${m.key}\n     本体: ${String(m.app).slice(0, 300)}\n     参照: ${String(m.ref_value).slice(0, 300)}\n     入力: ${JSON.stringify(m.input).slice(0, 300)}`);
    const byKey = {};
    for (const m of mismatches) byKey[`${m.ref}:${m.key}`] = (byKey[`${m.ref}:${m.key}`] || 0) + 1;
    console.log("項目別:", byKey);
  } else {
    console.log("不一致 0 件");
  }
}
process.exit(mismatches.length ? 1 : 0);
