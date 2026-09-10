// e2e07 データ整合監査（ブラウザ不要・数秒）
// 対応要件: Y 課題の解決可能性 / AA 罠の判別可能性 / AC マスタの整合性 / H 検証の対称性 / CP 表示名の一意性
"use strict";
const { loadApp, reporter } = require("./_lib");

const R = reporter("e2e07_data");
const { html, data } = loadApp();
const all = data.L1.concat(data.TY);

R.section("AC マスタの整合性");
R.ok("AC-1", data.L1.length === 11 && data.TY.length === 20 && data.PHONE.length === 6, `件数 L1=${data.L1.length} TY=${data.TY.length} PHONE=${data.PHONE.length}`);
R.ok("AC-2", all.every((d) => d.sender && d.text && ["high", "mid", "low"].includes(d.prio)), "送信者・本文・優先度がすべて有効");
R.ok("AC-3", data.TY.every((d) => d.reply && d.reply.length >= 4), "Level 2/3 のお手本がすべて非空");
R.ok("AC-4", data.PHONE.every((p) => p.caller), "電話の相手名がすべて非空");

R.section("Y/H 課題の解決可能性・検証の対称性");
R.ok("Y-1", data.L1.filter((d) => d.req).every((d) => d.copt !== "null" && Number(d.copt) < d.opts.length), "返信必要な Level1 問題はすべて有効な正解番号を持つ");
R.ok("Y-2", data.L1.filter((d) => !d.req).every((d) => d.copt === "null"), "返信不要な Level1 問題は正解番号が null");
R.ok("Y-3", data.L1.every((d) => d.opts.length === 3), "Level1 は全問3択（選択肢数で返信要否が漏れない）");
R.ok("H-1", data.TY.every((d) => !/[0-9A-Za-z]/.test(d.reply)), "お手本に半角英数字が無い（全角/半角の取り違えが起きない）");
R.ok("H-2", data.TY.every((d) => !/[　 ]/.test(d.reply.trim())), "お手本の途中に空白が無い（空白の有無で不一致にならない）");

R.section("AA 罠の判別可能性（本文の手がかりだけで返信要否が決まるか）");
const askWords = ["ください", "でしょうか", "ですか", "どうなって", "いかがいたしましょう", "お願いします", "来れそう", "必要です", "漏れています", "クレームが入って", "応答がありません", "ご来社されています", "迫っています", "ご返信", "てくれ"];
const favorWords = ["お土産", "メロン"];
const mismatch = all.filter((d) => {
  const predicted = d.text.includes("返信不要") ? false : (askWords.some((k) => d.text.includes(k)) || favorWords.some((k) => d.text.includes(k)));
  return predicted !== d.req;
});
R.ok("AA-1", mismatch.length === 0, `判定ルールと食い違う問題: ${mismatch.length}件 ${mismatch.map((d) => d.sender).join(",")}`);
R.ok("AA-2", !all.some((d) => d.text.includes("返信不要") && d.req), "「返信不要」と書いてあるのに返信必要な問題が無い");
R.ok("AA-3", data.L1.filter((d) => d.prio === "high").every((d) => /クレーム|ダウン|重要顧客|至急|本日/.test(d.text)), "Level1 の「高」は本文に至急の根拠がある");

R.section("CP 表示名の一意性");
for (const [name, rows] of [["L1", data.L1], ["TY", data.TY]]) {
  const c = {}; rows.forEach((d) => { c[d.sender] = (c[d.sender] || 0) + 1; });
  const dup = Object.entries(c).filter(([, v]) => v > 1);
  R.ok(`CP-${name}`, dup.length === 0, `${name} の送信者名の重複: ${dup.length ? dup.map(([k, v]) => `${k}×${v}`).join(",") : "なし"}`);
}
{
  const texts = new Map(); const dupT = [];
  all.forEach((d) => { if (texts.has(d.text) && texts.get(d.text) !== d.prio) dupT.push(d.text.slice(0, 20)); texts.set(d.text, d.prio); });
  R.ok("CP-3", dupT.length === 0, `同一本文で正解優先度が食い違う問題: ${dupT.length}件`);
}

R.section("本体ファイルの健全性");
R.ok("F-1", !/src="(?!data:)/.test(html), "外部ファイル参照が無い（HTML単体で完結）");
R.ok("F-2", (html.match(/data:image\/png;base64,/g) || []).length === 4, "ロゴが4箇所とも埋め込み");
R.ok("F-3", !/上前津・移行\.jpg|logo-access-job-kamimaezu\.jpg/.test(html), "旧ロゴのファイル名参照が残っていない");
R.ok("F-4", !/未読/.test(html), "「未読」表記が残っていない（未処理に統一）");

R.done([]);
