'use strict';
/*
 * 参照実装 A — dev-tests/spec/judgment-spec.md だけから書いた「表＋汎用処理」方式の判定モデル。
 * 依存なし・CommonJS。アプリ本体や他の検査ファイルは参照していない。
 *
 * 構成:
 *   1. 表（TABLES）  … ラベル・文言・閾値・列定義をすべてデータとして先に宣言する
 *   2. 汎用処理     … 表を読んで判定・文言生成・CSV 行を組み立てる小さな関数群
 *   3. 公開関数     … 仕様書の節に対応する関数（名前・引数・戻り値は仕様書どおり）
 * 文言は表の中にだけ置き、処理側には一切書かない。
 */

/* ===================================================================
 * 1. 表
 * =================================================================== */

// 2. ラベル表
const labels = Object.freeze({
  high: '高',
  mid: '中',
  low: '低',
  unread: '未処理',
  unreplied: '保留',
  completed: '処理済',
});

// 2. 終了理由表（該当なしは DEFAULT）
const END_REASON_TABLE = Object.freeze({
  time: '時間終了',
  complete: '全件完了',
});
const END_REASON_DEFAULT = '手動終了';

// 3-1. normalize の置換表（空白除去のあとに適用）
const NORMALIZE_REPLACEMENTS = Object.freeze([
  ['，', '、'], // ，
  ['．', '。'], // ．
]);

// 3-3. 案内文（上から最初に当てはまる行）。ctx = { d, t, matched, extra, done, tLen }
const FEEDBACK_RULES = Object.freeze([
  { when: (c) => c.done, text: '入力が一致しました。送信できます。' },
  { when: (c) => c.matched === c.tLen && c.extra > 0,
    text: '文字が多すぎます。末尾の {extra} 文字を消してください（一致 {matched}/{tLen} 文字）' },
  { when: (c) => c.d.length > c.matched, text: '一致 {matched}/{tLen} 文字。赤い文字の位置から直してください' },
  { when: () => true, text: '一致 {matched}/{tLen} 文字' },
]);

// 3-4. お手本の色付け（空白以外の文字。上から最初に当てはまる行）。ctx = { index, matched, dLen }
const MARK_STATE_RULES = Object.freeze([
  { when: (c) => c.index < c.matched, state: 'typed' },
  { when: (c) => c.matched <= c.index && c.index < c.dLen, state: 'wrong' },
  { when: () => true, state: 'plain' },
]);
const MARK_STATE_SPACE = 'space';

// 4. isReplyCorrect の表（action と level が一致した最初の行）
const REPLY_JUDGE_RULES = Object.freeze([
  { action: 'no_reply', levels: [1, 2, 3],
    test: (chat) => chat.requiresReply === false },
  { action: 'reply', levels: [1],
    test: (chat, result) => chat.requiresReply === true && result.optionIndex === chat.correctOpt },
  { action: 'reply', levels: [2, 3],
    test: (chat, result) => chat.requiresReply === true && normalize(result.selectedReply) === normalize(chat.reply) },
]);

// 6. レベル見出し表。ctx = { minutes }
const LEVEL_SUBTITLE_TABLE = Object.freeze({
  1: '選択式・全件完了で終了',
  2: '{minutes}分・タイピング式',
  3: '{minutes}分・タイピング式・電話割り込み',
});
const UNDELIVERED_SUFFIX = '（未着 {undelivered} 件）';
const SUBTITLE_JOINER = ' / ';

// 7. 集計の定数
const CONST = Object.freeze({
  GOOD: 80,
  PRAISE_MIN_COMPLETED: 3,
  PRAISE_MIN_PHONES: 2,
});

// 7-2. よかった点（この順で条件を満たす行を追加。何も追加されなければ fallback）
// ctx = summarize 内部の集計値（下記 buildSummaryContext）
const STRENGTH_RULES = Object.freeze([
  { when: (c) => c.completed > 0, text: '{completed}件を最後まで処理しました。' },
  { when: (c) => c.enough && isBelowOrAbove(c.prioAccuracy, '>=', CONST.GOOD),
    text: '優先度の判断が安定しています。' },
  { when: (c) => c.enough && isBelowOrAbove(c.replyAccuracy, '>=', CONST.GOOD)
                 && !isBelowOrAbove(c.noReplyAccuracy, '<', CONST.GOOD),
    text: '返信する、返信しないの切り分けが安定しています。' },
  { when: (c) => c.level === 3 && c.phoneCount >= CONST.PRAISE_MIN_PHONES
                 && isBelowOrAbove(c.phoneAccuracy, '>=', CONST.GOOD),
    text: '電話割り込みの緊急度判断が安定しています。' },
]);
const STRENGTH_FALLBACK = '開始して結果を残せています。次回は1件ずつ確実に進めましょう。';

// 7-3. 次の練習（この順で条件を満たす行を追加。何も追加されなければ fallback）
// 1行が複数の文を生む場合は texts に配列で並べ、each で「どの文を出すか」を判定する
const NEXT_STEP_RULES = Object.freeze([
  { when: (c) => c.undelivered > 0,
    text: '途中で終了したため、{undelivered}件のチャットが届く前に終わりました。次は最後まで続けてみましょう。' },
  { when: (c) => c.hasIncomplete,
    text: '未完了タスクを減らすため、未処理を開く順番を意識しましょう。' },
  { when: (c) => isBelowOrAbove(c.prioAccuracy, '<', CONST.GOOD),
    text: '高は緊急度と影響範囲、中は期限、低は情報共有や雑談を目印にしましょう。' },
  { when: (c) => isBelowOrAbove(c.replyAccuracy, '<', CONST.GOOD),
    each: [
      { when: (c) => c.repliedToNoReply,
        text: '本文に「返信不要」があるか、送信前に一度確認しましょう。返信不要の連絡は入力せずに完了します。' },
      { when: (c) => c.skippedRequired,
        text: '依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。' },
      { when: (c) => c.wrongReplyText,
        text: '相手の依頼に沿った返信文を選びましょう。' },
    ] },
  { when: (c) => !isBelowOrAbove(c.replyAccuracy, '<', CONST.GOOD)
                 && isBelowOrAbove(c.noReplyAccuracy, '<', CONST.GOOD),
    text: '返信不要タスクは入力せずに完了する練習を増やしましょう。' },
  { when: (c) => c.level === 3 && isBelowOrAbove(c.phoneAccuracy, '<', CONST.GOOD),
    text: '電話は相手と内容の緊急性を見て、応答と無視を切り替えましょう。' },
]);
const NEXT_STEP_FALLBACK = '次は同じ条件で速度を少し上げるか、上位レベルに進みましょう。';

// 8. 処理済チャットの訂正文（上から最初に当てはまる行）。ctx = { chat, level }
const PANEL_PRIO_RULES = Object.freeze([
  { when: (c) => !!c.chat.isPrioCorrect, text: '優先度は正解です。' },
  { when: () => true, text: '優先度は {correctPrioLabel} が正解です。' },
]);
const PANEL_REPLY_RULES = Object.freeze([
  { when: (c) => !!c.chat.isReplyCorrect, text: '返信処理は正解です。' },
  { when: (c) => !c.chat.requiresReply, text: '返信せずに完了するのが正解です。' },
  { when: (c) => c.level === 1 && c.chat.correctOpt != null, text: '正しい返信は「{correctOption}」です。' },
  { when: () => true, text: '正しい返信は「{reply}」です。' },
]);

// 9. 要確認タスク表の列（未完了 / 完了で分岐）。ctx = { chat, ... }
const RESULT_WORDS = Object.freeze({ correct: '正解', incorrect: '不正解', need: '返信必要', noNeed: '返信不要' });
const PRIORITY_RESULT_TEMPLATES = Object.freeze({
  incomplete: '正解: {correctPrioLabel}',
  completed: '{prioVerdict} / 正解: {correctPrioLabel} / 選択: {selectedPrioLabel}',
});
const REPLY_RESULT_TEMPLATES = Object.freeze({
  incomplete: '{replyNeed}',
  completed: '{replyVerdict} / {replyNeed}',
});

// 10. CSV 列定義（この順・17 列）。value(chat, session) が値を返す
const CSV_COLUMNS = Object.freeze([
  { header: 'レベル', value: (c, s) => `Level ${s.level}` },
  { header: '状態', value: (c) => label(c.status) },
  { header: '送信者', value: (c) => c.sender },
  { header: 'メッセージ内容', value: (c) => c.text },
  { header: '正解優先度', value: (c) => label(c.correctPrio) },
  { header: '選択優先度', value: (c) => (c.selectedPrio ? label(c.selectedPrio) : '') },
  { header: '優先度正誤', value: (c) => verdict(c.isPrioCorrect) },
  { header: '返信必要', value: (c) => (c.requiresReply ? '必要' : '不要') },
  { header: '選択処理', value: (c) => lookup(SELECTED_ACTION_TABLE, c.selectedAction, '') },
  { header: '返信正誤', value: (c) => verdict(c.isReplyCorrect) },
  { header: '確認時間(秒)', value: (c) => (c.openedAt ? secondsBetween(c.createdAt, c.openedAt) : '') },
  { header: '振り分け時間(秒)', value: (c) => (c.prioAt && c.selectedPrio ? secondsBetween(c.openedAt, c.prioAt) : '') },
  { header: '返信時間(秒)', value: (c) => (c.completedAt ? secondsBetween(c.prioAt, c.completedAt) : '') },
  { header: '総処理時間(秒)', value: (c) => (c.completedAt ? secondsBetween(c.openedAt, c.completedAt) : '') },
  { header: '制限時間(分)', value: (c, s) => (levelOf(s) === 1 ? '' : String(Math.round(s.durationSec / 60))) },
  { header: '終了理由', value: (c, s) => endReasonText(s.endReason) },
  { header: '未着件数', value: (c, s) => (levelOf(s) === 1 ? '0' : String(Math.max(0, s.undelivered))) },
]);
const SELECTED_ACTION_TABLE = Object.freeze({ reply: '返信', no_reply: '返信せず完了' });
const VERDICT_TABLE = Object.freeze({ true: '正解', false: '不正解' });

/* ===================================================================
 * 2. 汎用処理
 * =================================================================== */

/** テンプレートの {key} を ctx[key] で置き換える */
function fill(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in ctx ? String(ctx[key]) : m));
}

/** 表からキーを引く。無ければ fallback */
function lookup(table, key, fallback) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
}

/** ラベル表を引く（未知のキーは ""） */
function label(key) {
  return lookup(labels, key, '');
}

/** null → ""、真 → 正解、偽 → 不正解 */
function verdict(flag) {
  if (flag === null || flag === undefined) return '';
  return VERDICT_TABLE[flag ? 'true' : 'false'];
}

/** 「上から最初に当てはまる行」を返す */
function firstMatch(rules, ctx) {
  for (const rule of rules) if (rule.when(ctx)) return rule;
  return null;
}

/** 「条件を満たす行をこの順で全部集め、無ければ fallback」の文リスト生成 */
function collectTexts(rules, ctx, fallback) {
  const out = [];
  for (const rule of rules) {
    if (!rule.when(ctx)) continue;
    if (rule.each) {
      for (const sub of rule.each) if (sub.when(ctx)) out.push(fill(sub.text, ctx));
    } else {
      out.push(fill(rule.text, ctx));
    }
  }
  if (out.length === 0) out.push(fill(fallback, ctx));
  return out;
}

/** v が null でなく、op で閾値と比較して真か（null は常に偽） */
function isBelowOrAbove(v, op, threshold) {
  if (v === null || v === undefined) return false;
  return op === '<' ? v < threshold : v >= threshold;
}

function levelOf(objOrLevel) {
  const raw = objOrLevel && typeof objOrLevel === 'object' ? objOrLevel.level : objOrLevel;
  return Number(raw);
}

function pad2(n) {
  const s = String(n);
  return s.length >= 2 ? s : '0' + s;
}

function isWhitespaceChar(ch) {
  return /^\s$/.test(ch);
}

/* ===================================================================
 * 3. 公開関数
 * =================================================================== */

// ---- 3. 入力の正規化と一致 -----------------------------------------

function normalize(value) {
  if (value === null || value === undefined || value === '') return '';
  let s = String(value).replace(/\s/g, '');
  for (const [from, to] of NORMALIZE_REPLACEMENTS) s = s.split(from).join(to);
  return s;
}

function commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function typingProgress(draft, reply) {
  const d = normalize(draft);
  const t = normalize(reply);
  const matched = commonPrefixLength(d, t);
  const extra = Math.max(0, d.length - t.length);
  const done = d === t && t.length > 0;
  let percent = t.length === 0 ? 0 : Math.min(100, Math.round((matched / t.length) * 100));
  if (!done && percent === 100) percent = 99;
  const ctx = { d, t, matched, extra, done, tLen: t.length };
  const feedback = fill(firstMatch(FEEDBACK_RULES, ctx).text, ctx);
  return { percent, done, feedback, matched, extra };
}

function targetMarks(draft, reply) {
  const d = normalize(draft);
  const t = normalize(reply);
  const matched = commonPrefixLength(d, t);
  const source = reply === null || reply === undefined ? '' : String(reply);
  const marks = [];
  let index = 0;
  for (const char of source) {
    if (isWhitespaceChar(char)) {
      marks.push({ char, state: MARK_STATE_SPACE });
      continue;
    }
    const rule = firstMatch(MARK_STATE_RULES, { index, matched, dLen: d.length });
    marks.push({ char, state: rule.state });
    index++;
  }
  const extra = d.length > t.length ? d.slice(t.length) : '';
  return { marks, extra };
}

// ---- 4. 完了時の判定 ----------------------------------------------

function judge(chat, result, level) {
  const lv = Number(level);
  const isPrioCorrect = chat.correctPrio === chat.selectedPrio;
  const rule = REPLY_JUDGE_RULES.find((r) => r.action === result.action && r.levels.includes(lv));
  const isReplyCorrect = rule ? rule.test(chat, result) : false;
  return { isPrioCorrect, isReplyCorrect };
}

// ---- 5. 数値の補助 ------------------------------------------------

function percent(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 100);
}

function average(values) {
  const nums = [];
  for (const v of values || []) {
    if (v === '' || v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return (sum / nums.length).toFixed(1);
}

function formatStat(v) {
  return v === null || v === undefined ? '-' : String(v);
}

function secondsBetween(start, end) {
  if (!start || !end) return '';
  return ((end - start) / 1000).toFixed(1);
}

function formatTime(sec) {
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${pad2(m)}:${pad2(s)}`;
}

// ---- 6. 結果画面の見出し ------------------------------------------

function levelSubtitle(level, durationSec) {
  const template = lookup(LEVEL_SUBTITLE_TABLE, Number(level), '');
  return fill(template, { minutes: Math.round(durationSec / 60) });
}

function endReasonText(reason) {
  return lookup(END_REASON_TABLE, reason, END_REASON_DEFAULT);
}

function resultSubtitle(level, durationSec, reason, undelivered) {
  let text = levelSubtitle(level, durationSec) + SUBTITLE_JOINER + endReasonText(reason);
  if (undelivered > 0) text += fill(UNDELIVERED_SUFFIX, { undelivered });
  return text;
}

// ---- 7. 集計 ------------------------------------------------------

/** summarize の内部集計値（表の条件式が読む ctx） */
function buildSummaryContext(session) {
  const level = levelOf(session);
  const chats = session.chats || [];
  const phones = session.phoneRecords || [];
  const completedList = chats.filter((c) => c.status === 'completed');
  const total = chats.length;
  const completed = completedList.length;
  const undelivered = level === 1 ? 0 : Math.max(0, session.undelivered);
  const noReplyList = completedList.filter((c) => !c.requiresReply);
  return {
    level,
    total,
    completed,
    undelivered,
    prioAccuracy: percent(completedList.filter((c) => c.isPrioCorrect).length, completed),
    replyAccuracy: percent(completedList.filter((c) => c.isReplyCorrect).length, completed),
    averageTotal: average(completedList.map((c) => secondsBetween(c.openedAt, c.completedAt))),
    noReplyAccuracy: percent(noReplyList.filter((c) => c.isReplyCorrect).length, noReplyList.length),
    phoneCount: phones.length,
    phoneAccuracy: percent(phones.filter((p) => p.correct).length, phones.length),
    reviewRows: chats.filter((c) => c.status !== 'completed' || !c.isPrioCorrect || !c.isReplyCorrect),
    hasIncomplete: chats.some((c) => c.status !== 'completed'),
    repliedToNoReply: completedList.some((c) => !c.requiresReply && c.selectedAction === 'reply'),
    skippedRequired: completedList.some((c) => c.requiresReply && c.selectedAction === 'no_reply'),
    wrongReplyText: completedList.some((c) => c.requiresReply && c.selectedAction === 'reply' && !c.isReplyCorrect),
    enough: completed >= CONST.PRAISE_MIN_COMPLETED,
  };
}

function summarize(session) {
  const ctx = buildSummaryContext(session);
  return {
    total: ctx.total,
    completed: ctx.completed,
    undelivered: ctx.undelivered,
    prioAccuracy: ctx.prioAccuracy,
    replyAccuracy: ctx.replyAccuracy,
    averageTotal: ctx.averageTotal,
    phoneAccuracy: ctx.phoneAccuracy,
    strengths: collectTexts(STRENGTH_RULES, ctx, STRENGTH_FALLBACK),
    nextSteps: collectTexts(NEXT_STEP_RULES, ctx, NEXT_STEP_FALLBACK),
    reviewRows: ctx.reviewRows,
  };
}

// ---- 8. 処理済チャットの訂正文 ------------------------------------

function completedPanelText(chat, level) {
  const ctx = {
    chat,
    level: Number(level),
    correctPrioLabel: label(chat.correctPrio),
    correctOption: chat.correctOpt != null && chat.options ? chat.options[chat.correctOpt] : '',
    reply: chat.reply,
  };
  return {
    prioText: fill(firstMatch(PANEL_PRIO_RULES, ctx).text, ctx),
    replyText: fill(firstMatch(PANEL_REPLY_RULES, ctx).text, ctx),
  };
}

// ---- 9. 要確認タスク表の列 ----------------------------------------

function resultRowContext(chat) {
  return {
    chat,
    correctPrioLabel: label(chat.correctPrio),
    selectedPrioLabel: label(chat.selectedPrio),
    prioVerdict: chat.isPrioCorrect ? RESULT_WORDS.correct : RESULT_WORDS.incorrect,
    replyVerdict: chat.isReplyCorrect ? RESULT_WORDS.correct : RESULT_WORDS.incorrect,
    replyNeed: chat.requiresReply ? RESULT_WORDS.need : RESULT_WORDS.noNeed,
  };
}

function priorityResultText(chat) {
  const key = chat.status === 'completed' ? 'completed' : 'incomplete';
  return fill(PRIORITY_RESULT_TEMPLATES[key], resultRowContext(chat));
}

function replyResultText(chat) {
  const key = chat.status === 'completed' ? 'completed' : 'incomplete';
  return fill(REPLY_RESULT_TEMPLATES[key], resultRowContext(chat));
}

// ---- 10. CSV ------------------------------------------------------

function csvHeader() {
  return CSV_COLUMNS.map((col) => col.header);
}

function csvRow(chat, session) {
  return CSV_COLUMNS.map((col) => col.value(chat, session));
}

module.exports = {
  labels,
  normalize,
  commonPrefixLength,
  typingProgress,
  targetMarks,
  judge,
  percent,
  average,
  formatStat,
  secondsBetween,
  formatTime,
  levelSubtitle,
  endReasonText,
  resultSubtitle,
  summarize,
  completedPanelText,
  priorityResultText,
  replyResultText,
  csvHeader,
  csvRow,
};
