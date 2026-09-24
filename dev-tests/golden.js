// golden.js ゴールデン回帰（⑧）
//   固定の乱数入力 3,000 セッションについて、本体 Logic の全出力の指紋（ハッシュ）を golden/fingerprints.json に保存し、
//   以後の変更で「どの入力の、どの出力が変わったか」を機械的に示す。
//   node golden.js            … 保存済み指紋と比較（変わった入力を列挙）
//   node golden.js --update   … 指紋を作り直す（意図した変更のあとで実行し、差分をコミットする）
//   APP=path/to/app.html      … 対象を差し替え（変異検査が使う）／ JSON=1 で結果を JSON 1 行で出力
"use strict";
const fs = require("fs");
const path = require("path");
const { loadLogic, makeRng, genSession, genTypingCases, outputsOf, fingerprint } = require("./_logic-lib");

const SEED = 8675309;
const N = 3000;
const FILE = path.join(__dirname, "golden", "fingerprints.json");
const update = process.argv.includes("--update");
const JSON_OUT = !!process.env.JSON;

const app = loadLogic();
const rng = makeRng(SEED);
const KEYS = ["judgments", "total", "completed", "undelivered", "prioAccuracy", "replyAccuracy", "averageTotal", "phoneAccuracy", "strengths", "nextSteps", "reviewRows", "scoreCards", "subtitle", "reviewTexts", "completedPanels", "csvHeader", "csvRows", "labels", "timer", "typing"];

const rows = [];
const current = {};
for (let i = 0; i < N; i++) {
  const session = genSession(rng, i);
  const out = outputsOf(app, session);
  out.typing = genTypingCases(rng, session).map((c) => [app.typingProgress(c.draft, c.reply), app.targetMarks(c.draft, c.reply)]);
  const perKey = KEYS.map((k) => fingerprint(out[k]).slice(0, 6)).join("");
  rows.push(perKey);
  current[i] = out;
}

if (update) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ seed: SEED, n: N, keys: KEYS, rows }, null, 0));
  console.log(`ゴールデン指紋を保存しました: ${FILE}（${N} セッション）`);
  process.exit(0);
}

if (!fs.existsSync(FILE)) { console.error("指紋ファイルがありません。node golden.js --update で作成してください"); process.exit(2); }
const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
if (saved.seed !== SEED || saved.n !== N || saved.keys.join() !== KEYS.join()) { console.error("指紋の条件（seed/n/keys）が一致しません。--update で作り直してください"); process.exit(2); }

const changed = [];
const keyCounts = {};
for (let i = 0; i < N; i++) {
  if (saved.rows[i] === rows[i]) continue;
  const keys = [];
  for (let k = 0; k < KEYS.length; k++) {
    if (saved.rows[i].slice(k * 6, k * 6 + 6) !== rows[i].slice(k * 6, k * 6 + 6)) { keys.push(KEYS[k]); keyCounts[KEYS[k]] = (keyCounts[KEYS[k]] || 0) + 1; }
  }
  changed.push({ session: i, keys });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ n: N, changed: changed.length, keyCounts }));
} else {
  console.log(`ゴールデン回帰: ${N} セッション中、出力が変わった入力 ${changed.length} 件`);
  if (changed.length) {
    console.log("変わった出力の項目:", keyCounts);
    for (const c of changed.slice(0, 5)) {
      console.log(`  入力 #${c.session}: ${c.keys.join(", ")}`);
      for (const k of c.keys.slice(0, 3)) console.log(`     現在の ${k}: ${JSON.stringify(current[c.session][k]).slice(0, 240)}`);
    }
    if (changed.length > 5) console.log(`  … 他 ${changed.length - 5} 件（SEED=${SEED} の入力番号で再現できます）`);
    console.log("意図した変更なら: node golden.js --update");
  } else {
    console.log("すべて一致（意図しない出力の変化なし）");
  }
}
process.exit(changed.length ? 1 : 0);
