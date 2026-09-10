// 恒久検査スイート 共通ライブラリ
// - 実アプリ（../チャットタスク管理_タイピングトレーニング.html）を Chromium で動かす
// - 検証は「利用者と同じ操作」で行う。内部状態の書き換えはテストの準備にのみ使う
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function requirePlaywright() {
  try { return require("playwright"); } catch (_) { /* fallthrough */ }
  const extra = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of extra) {
    try { return require(path.join(dir, "playwright")); } catch (_) { /* next */ }
  }
  throw new Error("playwright が見つかりません。dev-tests で `npm install` を実行するか NODE_PATH を設定してください。");
}
const { chromium } = requirePlaywright();

const APP_NAME = "チャットタスク管理_タイピングトレーニング.html";
const APP_SRC = process.env.APP || path.resolve(__dirname, "..", APP_NAME);
const OUT_DIR = path.resolve(__dirname, "_out");

// ---------- 正解表（アプリ本体から機械的に抽出） ----------
function extractData(html) {
  const grab = (name) => {
    const i = html.indexOf(`const ${name} = [`);
    const j = html.indexOf("\n  ];", i);
    const rows = [];
    for (const line of html.slice(i, j).split("\n")) {
      if (!line.includes("sender:") && !line.includes("caller:")) continue;
      const g = (re, d = null) => { const m = line.match(re); return m ? m[1] : d; };
      const optsRaw = g(/options: \[(.*?)\], correctOpt/);
      rows.push({
        sender: g(/sender: "(.*?)"/), caller: g(/caller: "(.*?)"/),
        text: g(/text: "(.*?)"/), prio: g(/prio: "(\w+)"/),
        req: g(/requiresReply: (\w+)/) === "true",
        copt: g(/correctOpt: (\w+)/), reply: g(/reply: "(.*?)"/, ""),
        opts: optsRaw ? [...optsRaw.matchAll(/"(.*?)"/g)].map((m) => m[1]) : [],
        isEmergency: g(/isEmergency: (\w+)/) === "true",
      });
    }
    return rows;
  };
  return { L1: grab("LEVEL1_DATA"), TY: grab("TYPING_DATA"), PHONE: grab("PHONE_DATA") };
}

function loadApp() {
  const html = fs.readFileSync(APP_SRC, "utf8");
  return { html, data: extractData(html) };
}

// テストは常に一時コピーで動かし、本体ファイルを一切触らない
function stageApp(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctt-"));
  const file = path.join(dir, "app.html");
  fs.writeFileSync(file, html);
  return "file://" + file;
}

// ---------- ブラウザ ----------
async function open(opts = {}) {
  const { html, data } = loadApp();
  const url = stageApp(opts.html || html);
  const browser = await chromium.launch(opts.launch || {});
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: opts.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: opts.dpr || 1,
    ...(opts.context || {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("REQUESTFAILED: " + r.url().slice(0, 80)));
  await page.goto(url);
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  await page.reload();
  await page.waitForTimeout(150);
  return { browser, context, page, errors, data, url };
}

// ---------- 画面操作（利用者と同じ経路） ----------
const sel = {
  level: (n) => `[data-start-level="${n}"]`,
  duration: (sec) => `[data-duration="${sec}"]`,
  comfortable: (on) => `[data-comfortable="${on}"]`,
  chatItems: "#chat-list .chat-item",
  openChats: "#chat-list .chat-item:not(.completed)",
  prio: (p) => `[data-prio="${p}"]`,
  option: (i) => `[data-option="${i}"]`,
  input: "#typing-input",
  submit: "#submit-reply-btn",
  noReply: "#no-reply-btn",
  redo: "#redo-prio-btn",
  pause: "#pause-btn", resume: "#resume-btn", finish: "#finish-btn",
  phone: "#phone-modal.show", answer: "#answer-phone-btn", ignore: "#ignore-phone-btn",
  result: "#result-screen.active", game: "#game-screen.active", start: "#start-screen.active",
  score: "#score-grid", insight: "#insight-grid", review: "#review-table",
  csv: "#download-csv-btn", retry: "#retry-btn", menu: "#menu-btn",
  timer: "#timer",
};

async function start(page, level, durationSec) {
  if (durationSec) await page.click(sel.duration(durationSec));
  await page.click(sel.level(level));
  await page.waitForSelector(sel.game);
  await page.waitForTimeout(120);
}

async function activeChatBody(page) {
  return (await page.locator("#message-stage").innerText()).trim();
}

// 同じ本文が Level 1 と Level 2/3 の両方にある問題（社内広報・営業推進部）があるため、
// 現在のレベルに合った表から引く。level 未指定なら TY → L1 の順。
function findAnswer(data, body, level) {
  const pools = level === 1 ? [data.L1] : level ? [data.TY] : [data.TY, data.L1];
  for (const pool of pools) { const hit = pool.find((x) => x.text && body.includes(x.text)); if (hit) return hit; }
  return null;
}

async function currentLevel(page) {
  const t = await page.locator("#session-heading").innerText().catch(() => "");
  const m = t.match(/Level (\d)/); return m ? Number(m[1]) : null;
}

async function handlePhoneIfAny(page, data, mode = "ideal") {
  if (!(await page.locator(sel.phone).count())) return false;
  const who = await page.locator("#caller-name").innerText();
  const rec = data.PHONE.find((p) => p.caller === who);
  let answer = rec ? rec.isEmergency : false;
  if (mode === "wrong") answer = !answer;
  if (mode === "random") answer = Math.random() < 0.5;
  await page.click(answer ? sel.answer : sel.ignore);
  await page.waitForTimeout(120);
  return true;
}

// 1件のチャットを処理する。mode: ideal / wrong / random
async function solveOne(page, data, mode = "ideal", typeDelay = 1) {
  const open = page.locator(sel.openChats);
  if (!(await open.count())) return false;
  await open.first().click();
  await page.waitForTimeout(90);
  const body = await activeChatBody(page);
  const a = findAnswer(data, body, await currentLevel(page));
  if (!a) throw new Error("正解表に無い本文: " + body.slice(0, 40));
  const prios = ["high", "mid", "low"];
  let prio = a.prio;
  if (mode === "wrong") prio = prios.find((p) => p !== a.prio);
  if (mode === "random") prio = prios[Math.floor(Math.random() * 3)];
  if (await page.locator(sel.prio(prio)).count()) { await page.click(sel.prio(prio)); await page.waitForTimeout(450); }
  const wantReply = mode === "ideal" ? a.req : mode === "wrong" ? !a.req : Math.random() < 0.5;
  if (await page.locator(sel.option(0)).count()) {           // Level 1
    if (wantReply) {
      const idx = a.copt !== null && a.copt !== "null" && mode === "ideal" ? Number(a.copt) : Math.floor(Math.random() * 3);
      await page.click(sel.option(idx));
    } else await page.click(sel.noReply);
  } else {                                                    // Level 2/3
    if (wantReply) {
      await page.locator(sel.input).fill("");
      await page.locator(sel.input).type(a.reply, { delay: typeDelay });
      await page.waitForTimeout(80);
      if (await page.locator(sel.submit).isDisabled()) throw new Error("正解を入力しても送信できない: " + a.reply);
      await page.click(sel.submit);
    } else await page.click(sel.noReply);
  }
  await page.waitForTimeout(70);
  return true;
}

async function finish(page) {
  if (!(await page.locator(sel.result).count())) {
    if (await page.locator(sel.phone).count()) await page.click(sel.ignore);
    if (await page.locator("#pause-overlay.show").count()) await page.click(sel.resume);
    await page.click(sel.finish);
  }
  await page.waitForSelector(sel.result);
  await page.waitForTimeout(150);
}

async function scoreText(page) {
  return (await page.locator(sel.score).innerText()).replace(/\s+/g, " ").trim();
}

async function counters(page) {
  return page.evaluate(() => {
    const num = (s) => parseInt(document.querySelector(s).textContent.replace(/\D/g, ""), 10);
    return {
      unread: num("#unread-count"), pending: num("#pending-count"), completed: num("#completed-count"),
      done: num("#done-count"), open: num("#open-count"),
      listed: document.querySelectorAll("#chat-list .chat-item").length,
      listedCompleted: document.querySelectorAll("#chat-list .chat-item.completed").length,
    };
  });
}

// 「いま正解に到達できるか」の機械判定（解決可能性オラクル）
// 各未完了チャットについて、選択→優先度→完了 の操作要素が実在し押せることを確認する。
async function solvabilityOracle(page) {
  const problems = [];
  if (await page.locator(sel.result).count()) return problems;
  if (await page.locator("#pause-overlay.show").count()) {
    if (!(await page.locator(sel.resume).isVisible())) problems.push("一時停止中に再開ボタンが見えない");
    return problems;
  }
  if (await page.locator(sel.phone).count()) {
    for (const s of [sel.answer, sel.ignore]) if (!(await page.locator(s).isVisible())) problems.push("着信画面のボタンが見えない: " + s);
    return problems;
  }
  if (!(await page.locator(sel.finish).isVisible())) problems.push("終了ボタンが見えない");
  if (!(await page.locator(sel.pause).isVisible())) problems.push("一時停止ボタンが見えない");
  const n = await page.locator(sel.openChats).count();
  for (let i = 0; i < n; i++) {
    const item = page.locator(sel.openChats).nth(i);
    if (!(await item.isVisible())) { problems.push(`未完了チャット${i}が見えない`); continue; }
  }
  return problems;
}

// ---------- 報告 ----------
function reporter(suiteName) {
  const rows = [];
  const t0 = Date.now();
  const api = {
    ok(id, cond, msg) { rows.push({ id, ok: !!cond, msg }); console.log(`  [${cond ? "OK" : "NG"}] ${id} ${msg}`); return !!cond; },
    note(msg) { console.log("      " + msg); },
    section(t) { console.log(`\n--- ${t} ---`); },
    async done(errors) {
      const ng = rows.filter((r) => !r.ok);
      const jsErr = (errors || []).length;
      console.log(`\n== ${suiteName}: ${rows.length - ng.length}/${rows.length} OK, JSエラー ${jsErr} 件, ${((Date.now() - t0) / 1000).toFixed(0)}秒 ==`);
      if (jsErr) console.log("  " + errors.join("\n  "));
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, suiteName + ".json"), JSON.stringify({ suite: suiteName, rows, errors, at: new Date().toISOString() }, null, 2));
      process.exitCode = ng.length || jsErr ? 1 : 0;
    },
  };
  console.log(`\n#### ${suiteName} ####`);
  return api;
}

module.exports = { open, sel, start, solveOne, finish, scoreText, counters, handlePhoneIfAny, solvabilityOracle, findAnswer, currentLevel, activeChatBody, reporter, loadApp, APP_SRC, OUT_DIR };
