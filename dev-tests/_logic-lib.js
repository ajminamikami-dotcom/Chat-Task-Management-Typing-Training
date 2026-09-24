// _logic-lib.js 差分検査・変異検査・ゴールデン回帰の共通部品
//   - 本体 HTML から Logic ブロック（/* @@LOGIC_BEGIN */ 〜 /* @@LOGIC_END */）を切り出して Node で動かす
//   - 決定的な乱数でセッション（チャット・操作・時刻・電話・終了理由）を生成する
//   - 実装（本体 or 参照実装）に全出力を計算させる
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_NAME = "チャットタスク管理_タイピングトレーニング.html";
const APP_SRC = process.env.APP || path.resolve(__dirname, "..", APP_NAME);

function extractLogicSource(html) {
  const a = html.indexOf("/* @@LOGIC_BEGIN");
  const b = html.indexOf("/* @@LOGIC_END */");
  if (a < 0 || b < 0) throw new Error("Logic ブロック（@@LOGIC_BEGIN/@@LOGIC_END）が見つかりません");
  return html.slice(a, b);
}

function loadLogic(file) {
  const html = fs.readFileSync(file || APP_SRC, "utf8");
  return new Function(extractLogicSource(html) + "\n; return Logic;")();
}

// 本体からデータ表を抜く（_lib.js と同じ方式。ここでは reply/options も使う）
function loadData(file) {
  const html = fs.readFileSync(file || APP_SRC, "utf8");
  const grab = (name) => {
    const i = html.indexOf(`const ${name} = [`);
    const j = html.indexOf("\n  ];", i);
    const rows = [];
    for (const line of html.slice(i, j).split("\n")) {
      if (!line.includes("sender:") && !line.includes("caller:")) continue;
      const g = (re, d = null) => { const m = line.match(re); return m ? m[1] : d; };
      const optsRaw = g(/options: \[(.*?)\], correctOpt/);
      rows.push({
        sender: g(/sender: "(.*?)"/), caller: g(/caller: "(.*?)"/), text: g(/text: "(.*?)"/), prio: g(/prio: "(\w+)"/),
        requiresReply: g(/requiresReply: (\w+)/) === "true",
        correctOpt: (() => { const v = g(/correctOpt: (\w+)/); return v === null || v === "null" ? null : Number(v); })(),
        reply: g(/reply: "(.*?)"/, ""),
        options: optsRaw ? [...optsRaw.matchAll(/"(.*?)"/g)].map((m) => m[1]) : [],
        isEmergency: g(/isEmergency: (\w+)/) === "true",
      });
    }
    return rows;
  };
  return { L1: grab("LEVEL1_DATA"), TY: grab("TYPING_DATA"), PHONE: grab("PHONE_DATA") };
}

// ---------- 決定的乱数（mulberry32） ----------
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

// ---------- 入力の改変パターン（お手本 → 下書き） ----------
const PUNCT_SWAP = { "、": "，", "。": "．" };
function mutateReply(rng, reply) {
  const kind = rng.pick(["exact", "exact", "prefix", "typo", "extra", "missing", "punct", "space", "empty", "other", "insert", "double"]);
  const chars = Array.from(reply);
  switch (kind) {
    case "exact": return { kind, draft: reply };
    case "prefix": return { kind, draft: chars.slice(0, rng.int(0, chars.length - 1)).join("") };
    case "typo": { const i = rng.int(0, chars.length - 1); const c = chars.slice(); c[i] = c[i] === "あ" ? "い" : "あ"; return { kind, draft: c.join("") }; }
    case "extra": return { kind, draft: reply + rng.pick(["。", "。。", "！", "あ", " "]) };
    case "missing": { const i = rng.int(0, chars.length - 1); const c = chars.slice(); c.splice(i, 1); return { kind, draft: c.join("") }; }
    case "punct": return { kind, draft: chars.map((ch) => PUNCT_SWAP[ch] || ch).join("") };
    case "space": { const i = rng.int(0, chars.length); const c = chars.slice(); c.splice(i, 0, rng.pick([" ", "　", "\n"])); return { kind, draft: " " + c.join("") + "　" }; }
    case "empty": return { kind, draft: "" };
    case "other": return { kind, draft: rng.pick(["承知しました。", "了解です", "abc", "１２３", "承知いたしました。至急対応します。"]) };
    case "insert": { const i = rng.int(0, chars.length); const c = chars.slice(); c.splice(i, 0, "ん"); return { kind, draft: c.join("") }; }
    case "double": return { kind, draft: reply + reply };
    default: return { kind, draft: reply };
  }
}

// ---------- セッション生成 ----------
const PRIOS = ["high", "mid", "low"];
const REASONS = ["time", "complete", "manual"];
const DURATIONS = [300, 600, 900];
let DATA = null;

function genSession(rng, index) {
  if (!DATA) DATA = loadData();
  const level = rng.pick([1, 2, 3]);
  const durationSec = rng.pick(DURATIONS);
  const pool = level === 1 ? DATA.L1 : DATA.TY;
  // 届いた件数（Level 1 は全11件、Level 2/3 は 4〜20 件）
  const delivered = level === 1 ? pool.length : rng.int(0, pool.length);
  const order = pool.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  const base = 1700000000000 + rng.int(0, 1e9);
  const chats = [];
  for (let i = 0; i < delivered; i++) {
    const d = order[i];
    const createdAt = base + i * rng.int(1000, 40000);
    const chat = {
      id: i + 1, sender: d.sender, text: d.text, correctPrio: d.prio, options: d.options, correctOpt: d.correctOpt, reply: d.reply,
      requiresReply: d.requiresReply, status: "unread", selectedPrio: null, selectedAction: "", selectedReply: "", draft: "",
      createdAt, openedAt: null, prioAt: null, completedAt: null, isPrioCorrect: null, isReplyCorrect: null,
    };
    const r = rng.next();
    if (r < 0.25) {
      // 未処理（開いたかどうかは半々。開いた後に優先度を選び直して未処理に戻したもの＝prioAt だけ残る、も混ぜる）
      if (rng.chance(0.5)) chat.openedAt = createdAt + rng.int(500, 60000);
      if (chat.openedAt && rng.chance(0.3)) chat.prioAt = chat.openedAt + rng.int(300, 20000);
    } else if (r < 0.45) {
      // 保留（優先度選択済み、下書きあり／なし）
      chat.status = "unreplied";
      chat.openedAt = createdAt + rng.int(500, 60000);
      chat.selectedPrio = rng.pick(PRIOS);
      chat.prioAt = chat.openedAt + rng.int(300, 20000);
      if (level !== 1 && rng.chance(0.6)) chat.draft = mutateReply(rng, d.reply).draft;
    } else {
      // 処理済
      chat.status = "completed";
      chat.openedAt = createdAt + rng.int(500, 60000);
      chat.selectedPrio = rng.chance(0.7) ? d.prio : rng.pick(PRIOS);
      chat.prioAt = chat.openedAt + rng.int(300, 20000);
      chat.completedAt = chat.prioAt + rng.int(300, 90000);
      // まれに時刻の欠落（openedAt が無いまま完了、など壊れたデータ）も混ぜる
      if (rng.chance(0.03)) chat.openedAt = null;
      if (rng.chance(0.03)) chat.prioAt = null;
      const wantReply = rng.chance(0.7) ? d.requiresReply : !d.requiresReply;
      let result;
      if (!wantReply) result = { action: "no_reply", selectedReply: "" };
      else if (level === 1) result = { action: "reply", optionIndex: rng.chance(0.75) && d.correctOpt !== null ? d.correctOpt : rng.int(0, 2), selectedReply: "" };
      else result = { action: "reply", selectedReply: mutateReply(rng, d.reply).draft };
      if (result.action === "reply" && level === 1) result.selectedReply = d.options[result.optionIndex] || "";
      chat.selectedAction = result.action;
      chat.selectedReply = result.selectedReply;
      chat.draft = level === 1 ? "" : result.selectedReply;
      chat._result = result;   // 判定の入力（本体・参照の judge に渡す）
    }
    chats.push(chat);
  }
  const phoneRecords = [];
  if (level === 3) {
    const n = rng.int(0, 7);
    for (let i = 0; i < n; i++) {
      const p = rng.pick(DATA.PHONE);
      const didAnswer = rng.chance(0.65) ? p.isEmergency : !p.isEmergency;
      phoneRecords.push({ caller: p.caller, isEmergency: p.isEmergency, didAnswer, correct: p.isEmergency === didAnswer });
    }
  }
  const endReason = rng.chance(0.04) ? rng.pick(["", "unknown"]) : rng.pick(REASONS);   // 想定外の終了理由は「手動終了」扱い（仕様 §2）
  const undelivered = level === 1 ? rng.pick([0, 0, 0, 2, 5]) : pool.length - delivered;    // Level 1 は常に 0 として扱われる（仕様 §7-1）
  return { index, level, durationSec, chats, phoneRecords, endReason, undelivered };
}

function genTypingCases(rng, session) {
  if (session.level === 1) return [];
  const cases = [];
  if (rng.chance(0.05)) cases.push({ draft: "", reply: "", kind: "empty-both" });   // 空のお手本では done にならない（仕様 §3-3）
  for (const chat of session.chats.slice(0, 3)) {
    const m = mutateReply(rng, chat.reply);
    cases.push({ draft: m.draft, reply: chat.reply, kind: m.kind });
  }
  return cases;
}

// ---------- 実装に全出力を計算させる ----------
function outputsOf(impl, session) {
  const level = session.level;
  // judge を各処理済チャットに適用（本体では finishChat が行う）
  const chats = session.chats.map((c) => {
    const chat = { ...c };
    delete chat._result;
    if (c.status === "completed") Object.assign(chat, impl.judge(chat, c._result, level));
    return chat;
  });
  const sess = { level, durationSec: session.durationSec, chats, phoneRecords: session.phoneRecords, endReason: session.endReason, undelivered: session.undelivered };
  const summary = impl.summarize(sess);
  const csvSession = { level, durationSec: session.durationSec, endReason: session.endReason, undelivered: session.undelivered };
  return {
    judgments: chats.map((c) => (c.status === "completed" ? [c.isPrioCorrect, c.isReplyCorrect] : null)),
    total: summary.total,
    completed: summary.completed,
    undelivered: summary.undelivered,
    prioAccuracy: summary.prioAccuracy,
    replyAccuracy: summary.replyAccuracy,
    averageTotal: summary.averageTotal,
    phoneAccuracy: summary.phoneAccuracy,
    strengths: summary.strengths,
    nextSteps: summary.nextSteps,
    reviewRows: summary.reviewRows.map((c) => c.id),
    scoreCards: [`${summary.completed}/${summary.total}`, impl.formatStat(summary.prioAccuracy), impl.formatStat(summary.replyAccuracy), impl.formatStat(summary.averageTotal), level === 3 ? impl.formatStat(summary.phoneAccuracy) : null],
    subtitle: impl.resultSubtitle(level, session.durationSec, session.endReason, summary.undelivered),
    reviewTexts: summary.reviewRows.map((c) => [impl.priorityResultText(c), impl.replyResultText(c)]),
    completedPanels: chats.filter((c) => c.status === "completed").map((c) => impl.completedPanelText(c, level)),
    csvHeader: impl.csvHeader(),
    csvRows: chats.slice().sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).map((c) => impl.csvRow(c, csvSession)),
    labels: impl.labels,
    timer: impl.formatTime(Math.max(0, session.durationSec - (session.index % 601))),   // 残り時間は 0 以上の整数秒（本体は clamp してから渡す）
  };
}

function fingerprint(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

module.exports = { APP_SRC, extractLogicSource, loadLogic, loadData, makeRng, genSession, genTypingCases, outputsOf, fingerprint, mutateReply };
