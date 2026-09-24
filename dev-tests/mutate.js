// mutate.js 変異検査（⑦）
//   本体に意図的な誤りを 1 箇所ずつ仕込んだ「変異体」を作り、各検査が捕まえられるかを測る。
//   検査が捕まえられない変異体は「その規則を守る検査が無い」ことを意味する（等価な変異は除く）。
//   node mutate.js              … Logic の変異体: 差分検査＋ゴールデン＋e2e07。UI の変異体: e2e10
//   FULL=1 node mutate.js       … Logic の変異体にも e2e10（ブラウザ）を掛ける（長い）
//   ONLY=L03,U02 node mutate.js … 指定した変異体だけ
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { APP_SRC } = require("./_logic-lib");

const ORIGIN = fs.readFileSync(APP_SRC, "utf8");
const FULL = !!process.env.FULL;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

// [id, 説明, 置換前, 置換後]。置換前は本体に 1 回だけ現れること。
const LOGIC_MUTANTS = [
  ["L01", "優先度の正誤を反転", "const isPrioCorrect = chat.correctPrio === chat.selectedPrio;", "const isPrioCorrect = chat.correctPrio !== chat.selectedPrio;"],
  ["L02", "返信せず完了の正誤を反転", "isReplyCorrect = chat.requiresReply === false;", "isReplyCorrect = chat.requiresReply === true;"],
  ["L03", "Level 1 の選択肢判定を反転", "result.optionIndex === chat.correctOpt;", "result.optionIndex !== chat.correctOpt;"],
  ["L04", "Level 2/3 の一致判定を正規化なしに", "normalize(result.selectedReply) === normalize(chat.reply);", "result.selectedReply === chat.reply;"],
  ["L05", "句読点の同一視を外す", '.replace(/，/g, "、").replace(/．/g, "。");', ';'],
  ["L06", "空白の無視を外す", 'return String(value || "").replace(/\\s+/g, "")', 'return String(value || "")'],
  ["L07", "前方一致数を 1 つ多く数える", "while (index < max && a[index] === b[index]) index += 1;", "while (index <= max && a[index] === b[index]) index += 1;"],
  ["L08", "未一致の 100% を 99 にしない", "if (!done && percentValue === 100) percentValue = 99;", ""],
  ["L09", "空のお手本で done になる", "const done = draft === target && target.length > 0;", "const done = draft === target;"],
  ["L10", "一致時の案内文を短くする", '"入力が一致しました。送信できます。"', '"入力が一致しました。"'],
  ["L11", "余分な文字の条件を緩める", "else if (matched === target.length && extra > 0)", "else if (extra > 0)"],
  ["L12", "色付けの境界を 1 つずらす", 'if (index < matched) return { char, state: "typed" };', 'if (index <= matched) return { char, state: "typed" };'],
  ["L13", "余分な文字を表示しない", 'extra: draft.length > target.length ? draft.slice(target.length) : ""', 'extra: ""'],
  ["L14", "分母 0 で 0% を返す", "if (!denominator) return null;", "if (!denominator) return 0;"],
  ["L15", "百分率を切り捨てる", "return Math.round((numerator / denominator) * 100);", "return Math.floor((numerator / denominator) * 100);"],
  ["L16", "平均を整数にする", "return (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1);", "return (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(0);"],
  ["L17", "平均で未計測を除外しない", '.filter((value) => value !== "" && value !== null && value !== undefined)', ".filter(() => true)"],
  ["L18", "秒差の空欄条件を緩める", 'if (!start || !end) return "";', 'if (!start && !end) return "";'],
  ["L19", "時計の秒を 1 桁にする", 'const seconds = (totalSeconds % 60).toString().padStart(2, "0");', 'const seconds = (totalSeconds % 60).toString();'],
  ["L20", "「安定」の境界を 70% に", "const GOOD = 80;", "const GOOD = 70;"],
  ["L21", "称賛の最低完了数を 1 に", "const PRAISE_MIN_COMPLETED = 3;", "const PRAISE_MIN_COMPLETED = 1;"],
  ["L22", "電話称賛の最低件数を 0 に", "const PRAISE_MIN_PHONES = 2;", "const PRAISE_MIN_PHONES = 0;"],
  ["L23", "優先度の称賛行を削除", 'if (enough && prioAccuracy !== null && prioAccuracy >= GOOD) strengths.push("優先度の判断が安定しています。");', ""],
  ["L24", "返信不要の見落としがあっても称賛", "&& !(noReplyAccuracy !== null && noReplyAccuracy < GOOD) && !(requiredReplyAccuracy", "&& true && !(requiredReplyAccuracy"],
  ["L25", "未着の助言行を削除", "if (undelivered > 0) nextSteps.push(`途中で終了したため、${undelivered}件のチャットが届く前に終わりました。次は最後まで続けてみましょう。`);", ""],
  ["L26", "未完了の助言行を削除", 'if (chats.some((chat) => chat.status !== "completed")) nextSteps.push("未完了タスクを減らすため、未処理を開く順番を意識しましょう。");', ""],
  ["L27", "返信の助言を内訳と重ねて二重に出す", "      } else {\n        if (noReplyAccuracy !== null && noReplyAccuracy < GOOD)", "      }\n      {\n        if (noReplyAccuracy !== null && noReplyAccuracy < GOOD)"],
  ["L28", "返信文の助言行を削除", 'if (wrongReplyText) nextSteps.push("相手の依頼に沿った返信文を選びましょう。");', ""],
  ["L29", "助言の順序を入れ替える", 'if (repliedToNoReply) nextSteps.push("本文に「返信不要」があるか、送信前に一度確認しましょう。返信不要の連絡は入力せずに完了します。");\n        if (skippedRequired) nextSteps.push("依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。");', 'if (skippedRequired) nextSteps.push("依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。");\n        if (repliedToNoReply) nextSteps.push("本文に「返信不要」があるか、送信前に一度確認しましょう。返信不要の連絡は入力せずに完了します。");'],
  ["L30", "最後の助言を常に出す", 'if (nextSteps.length === 0) nextSteps.push("次は同じ条件で速度を少し上げるか、上位レベルに進みましょう。");', 'nextSteps.push("次は同じ条件で速度を少し上げるか、上位レベルに進みましょう。");'],
  ["L31", "要確認の条件を AND にする", "return !chat.isPrioCorrect || !chat.isReplyCorrect;", "return !chat.isPrioCorrect && !chat.isReplyCorrect;"],
  ["L32", "終了理由の既定を時間終了に", "return END_REASON[reason] || END_REASON.manual;", "return END_REASON[reason] || END_REASON.time;"],
  ["L33", "未着 1 件を副題に出さない", "${undelivered ? `（未着 ${undelivered} 件）` : \"\"}", "${undelivered > 1 ? `（未着 ${undelivered} 件）` : \"\"}"],
  ["L34", "分を切り捨てる（等価: 300/600/900 秒では同じ）", "if (level === 2) return `${Math.round(durationSec / 60)}分・タイピング式`;", "if (level === 2) return `${Math.floor(durationSec / 60)}分・タイピング式`;"],
  ["L35", "Level 1 の訂正文の条件を緩める（等価: 返信必要の問題は必ず correctOpt を持つ＝e2e07 Y-1）", "else if (level === 1 && chat.correctOpt !== null) replyText", "else if (level === 1) replyText"],
  ["L36", "訂正文に選んだ優先度を出す", "`優先度は ${labels[chat.correctPrio]} が正解です。`", "`優先度は ${labels[chat.selectedPrio]} が正解です。`"],
  ["L37", "要確認表の「不正解」を別の語に", 'return `${chat.isPrioCorrect ? "正解" : "不正解"} / 正解: ${labels[chat.correctPrio]} / 選択: ${labels[chat.selectedPrio]}`;', 'return `${chat.isPrioCorrect ? "正解" : "誤り"} / 正解: ${labels[chat.correctPrio]} / 選択: ${labels[chat.selectedPrio]}`;'],
  ["L38", "要確認表の返信要否を逆に", 'return `${chat.isReplyCorrect ? "正解" : "不正解"} / ${chat.requiresReply ? "返信必要" : "返信不要"}`;', 'return `${chat.isReplyCorrect ? "正解" : "不正解"} / ${chat.requiresReply ? "返信不要" : "返信必要"}`;'],
  ["L39", "CSV の未着件数の列名を削除", '"確認時間(秒)", "振り分け時間(秒)", "返信時間(秒)", "総処理時間(秒)", "制限時間(分)", "終了理由", "未着件数"', '"確認時間(秒)", "振り分け時間(秒)", "返信時間(秒)", "総処理時間(秒)", "制限時間(分)", "終了理由"'],
  ["L40", "振り分け時間の条件を緩める", 'chat.prioAt && chat.selectedPrio ? secondsBetween(chat.openedAt, chat.prioAt) : "",', 'chat.prioAt ? secondsBetween(chat.openedAt, chat.prioAt) : "",'],
  ["L41", "Level 1 の未着件数を空欄に", 'level === 1 ? "0" : String(Math.max(0, session.undelivered || 0))', 'level === 1 ? "" : String(Math.max(0, session.undelivered || 0))'],
  ["L42", "CSV の選択処理の語を変える", '"返信せず完了"', '"返信せず"'],
  ["L43", "CSV の未判定を「-」に", 'chat.isPrioCorrect === null ? "" : chat.isPrioCorrect ? "正解" : "不正解",', 'chat.isPrioCorrect === null ? "-" : chat.isPrioCorrect ? "正解" : "不正解",'],
  ["L44", "Level 1 でも未着を数える", "const undelivered = level === 1 ? 0 : Math.max(0, session.undelivered || 0);", "const undelivered = Math.max(0, session.undelivered || 0);"],
  ["L45", "ラベルを「未読」に戻す", 'unread: "未処理"', 'unread: "未読"'],
  ["L46", "Level 1 で返信不要に返信しても正解（等価: 返信不要の問題は correctOpt が null＝e2e07 Y-2）", "isReplyCorrect = chat.requiresReply === true && result.optionIndex === chat.correctOpt;", "isReplyCorrect = result.optionIndex === chat.correctOpt;"],
  ["L47", "Level 2/3 で返信不要に返信しても正解", "isReplyCorrect = chat.requiresReply === true && normalize(result.selectedReply) === normalize(chat.reply);", "isReplyCorrect = normalize(result.selectedReply) === normalize(chat.reply);"],
  ["L48", "完了 1 件の称賛を出さない", "if (completed.length > 0) strengths.push(`${completed.length}件を最後まで処理しました。`);", "if (completed.length > 1) strengths.push(`${completed.length}件を最後まで処理しました。`);"],
  ["L49", "電話判断を「応答した数」で数える", "const phoneAccuracy = percent(phoneRecords.filter((phone) => phone.correct).length, phoneRecords.length);", "const phoneAccuracy = percent(phoneRecords.filter((phone) => phone.didAnswer).length, phoneRecords.length);"],
  ["L50", "平均処理を振り分け時刻から測る", "const averageTotal = average(completed.map((chat) => secondsBetween(chat.openedAt, chat.completedAt)));", "const averageTotal = average(completed.map((chat) => secondsBetween(chat.prioAt, chat.completedAt)));"],
  ["L51", "百分率の上限を外す（等価: matched ≤ 長さ）", "let percentValue = target.length ? Math.min(100, Math.round((matched / target.length) * 100)) : 0;", "let percentValue = target.length ? Math.round((matched / target.length) * 100) : 0;"],
  ["L52", "誤り位置の案内を消す", "else if (draft.length > matched) feedback = `一致 ${matched}/${target.length} 文字。赤い文字の位置から直してください`;", "else if (draft.length > matched) feedback = `一致 ${matched}/${target.length} 文字`;"],
  ["L53", "空白判定を半角スペースだけに", 'if (/\\s/.test(char)) return { char, state: "space" };', 'if (char === " ") return { char, state: "space" };'],
  ["L54", "CSV のレベル表記からスペースを削除", "`Level ${level}`,", "`Level${level}`,"],
  ["L56", "要確認表から未完了行を外す", 'if (chat.status !== "completed") return true;', 'if (chat.status !== "completed") return false;'],
  ["L57", "強みの既定行を削除", 'if (strengths.length === 0) strengths.push("開始して結果を残せています。次回は1件ずつ確実に進めましょう。");', ""],
  ["L58", "優先度の助言行を削除", 'if (prioAccuracy !== null && prioAccuracy < GOOD) nextSteps.push("高は緊急度と影響範囲、中は期限、低は情報共有や雑談を目印にしましょう。");', ""],
  ["L59", "電話の助言行を削除", 'if (level === 3 && phoneAccuracy !== null && phoneAccuracy < GOOD) nextSteps.push("電話は相手と内容の緊急性を見て、応答と無視を切り替えましょう。");', ""],
  ["L60", "電話の称賛行を削除", 'if (level === 3 && phoneRecords.length >= PRAISE_MIN_PHONES && phoneAccuracy !== null && phoneAccuracy >= GOOD) strengths.push("電話割り込みの緊急度判断が安定しています。");', ""],
  ["L61", "既定の助言行を削除", 'if (nextSteps.length === 0) nextSteps.push("次は同じ条件で速度を少し上げるか、上位レベルに進みましょう。");', ""],
  ["L62", "返信不要の助言行を削除", 'if (noReplyAccuracy !== null && noReplyAccuracy < GOOD) nextSteps.push("返信不要タスクは入力せずに完了する練習を増やしましょう。");', ""],
  ["L63", "返信必要の助言行を削除", 'if (requiredReplyAccuracy !== null && requiredReplyAccuracy < GOOD) nextSteps.push("依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。");', ""],
  ["L64", "集計の未着クランプを外す", "const undelivered = level === 1 ? 0 : Math.max(0, session.undelivered || 0);", "const undelivered = level === 1 ? 0 : (session.undelivered || 0);"],
  ["L65", "CSV の未着クランプを外す", 'level === 1 ? "0" : String(Math.max(0, session.undelivered || 0))', 'level === 1 ? "0" : String(session.undelivered || 0)'],
  ["L66", "電話判断の正誤を反転", "return { correct: isEmergency === didAnswer };", "return { correct: isEmergency !== didAnswer };"],
  ["L67", "CSV の受信順並べ替えを外す", "return chats.slice().sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).map((chat) => csvRow(chat, session));", "return chats.slice().map((chat) => csvRow(chat, session));"],
  ["L68", "CSV の同時刻の id 順を外す", "sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)", "sort((a, b) => a.createdAt - b.createdAt)"],
  ["L69", "訂正文の返信不要の行を削除", 'else if (!chat.requiresReply) replyText = "返信せずに完了するのが正解です。";', ""],
  ["L70", "要確認表の未完了の優先度表示を変える", "if (chat.status !== \"completed\") return `正解: ${labels[chat.correctPrio]}`;", "if (chat.status !== \"completed\") return `${labels[chat.correctPrio]}`;"],
  ["L71", "切り分けの称賛で返信必要の内訳を見ない", "&& !(requiredReplyAccuracy !== null && requiredReplyAccuracy < GOOD)) strengths.push", ") strengths.push"],
  ["L55", "要確認表を逆順にする", "const reviewRows = chats.filter((chat) => {\n        if (chat.status !== \"completed\") return true;\n        return !chat.isPrioCorrect || !chat.isReplyCorrect;\n      });", "const reviewRows = chats.filter((chat) => {\n        if (chat.status !== \"completed\") return true;\n        return !chat.isPrioCorrect || !chat.isReplyCorrect;\n      }).reverse();"],
];

const UI_MUTANTS = [
  ["U01", "画面切替直後のマウスガードを外す", "const POINTER_SETTLE_MS = 400;", "const POINTER_SETTLE_MS = 0;"],
  ["U02", "同じ位置の再クリックガードを外す", "const SAME_SPOT_MS = 700;", "const SAME_SPOT_MS = 0;"],
  ["U03", "着信直後のキー締め出しを外す", "const KEY_SETTLE_MS = 500;", "const KEY_SETTLE_MS = 0;"],
  ["U04", "キー長押しのリピートを通す", 'if (event.repeat && (event.key === "Enter" || event.key === " " || event.key === "Escape")) {', "if (false) {"],
  ["U05", "表示中の着信を上書きする（等価: 現在の予約経路では表示中に showPhone は呼ばれない。多重防御）", "if (state.gameOver || state.paused || state.currentPhone) return;", "if (state.gameOver || state.paused) return;"],
  ["U06", "再開時に新着を固定 1.5 秒で張り直す", "if (state.chatLeft !== null) scheduleNextChat(Math.max(1500, state.chatLeft));", "scheduleNextChat(1500);"],
  ["U07", "停止時間を処理時間から除かない", "state.chats.forEach((chat) => {\n          if (chat.status === \"completed\") return;", "state.chats.forEach((chat) => {\n          return;"],
  ["U08", "終了ボタンを確認なしにする", 'els.finishBtn.addEventListener("click", openFinishConfirm);', 'els.finishBtn.addEventListener("click", () => endGame("manual"));'],
  ["U09", "背面を不活性にしない", 'els.gameShell.inert = state.paused || els.phoneModal.classList.contains("show");', "els.gameShell.inert = false;"],
  ["U10", "結果画面の離脱確認を出さない", 'if (document.getElementById("start-screen").classList.contains("active")) return;', 'if (!document.getElementById("game-screen").classList.contains("active")) return;'],
  ["U11", "下書きありの「返信せずに完了」を 1 回で確定", 'if (normalize(chat.draft) && noReplyBtn.dataset.confirm !== "1") {', "if (false) {"],
  ["U12", "送信ボタンを常に有効表示", 'aria-disabled="${progress.done ? "false" : "true"}"', 'aria-disabled="false"'],
  ["U13", "完了後にフォーカスを移さない", "function focusNextOpenChat() {\n    const next = els.chatList.querySelector(\".chat-item:not(.completed)\");\n    if (next) next.focus();\n    else els.inboxTitle.focus();\n  }", "function focusNextOpenChat() {}"],
  ["U14", "IME 変換中も色付けを更新する", "if (event.isComposing || state.composing) return;\n      updateTypingProgress(chat);", "updateTypingProgress(chat);"],
  ["U15", "変換中の着信を先送りしない", "if (state.composing && state.phoneDefer < 1500) {", "if (false) {"],
  ["U16", "結果画面の横はみ出し対策を外す", ".result-layout > * {\n    min-width: 0;\n  }", ".result-layout > * {\n    min-width: auto;\n  }"],
  ["U17", "ゆったり表示の下段を固定比率に戻す", "grid-template-rows: minmax(0, 1fr) minmax(0, max-content);", "grid-template-rows: minmax(0, 1.35fr) minmax(0, 1fr);"],
  ["U18", "停止時間を残り時間に戻さない", "        state.endsAt += delta;\n", ""],
  ["U19", "停止中も時計を進める", "  function gameTick() {\n    if (state.gameOver || state.paused) return;", "  function gameTick() {\n    if (state.gameOver) return;"],
  ["U20", "キー操作もマウス扱いにする（原則 5 違反）", "return Boolean(event && (event.clientX || event.clientY));", "return Boolean(event);"],
  ["U21", "着信中・停止中の Alt+数字を背面に通す", 'if (state.paused || els.phoneModal.classList.contains("show")) return;\n        const prio', "const prio"],
  ["U22", "IME 確定の Enter で送信する", "if (event.isComposing || event.keyCode === 229 || event.repeat) return;", "if (event.repeat) return;"],
  ["U23", "入力欄の Esc でも一時停止する", 'if (state.paused || !target || target.id !== "typing-input") togglePause();', "togglePause();"],
  ["U24", "開き直しで確認時刻を付け替える", "if (!chat.openedAt) chat.openedAt = Date.now();", "chat.openedAt = Date.now();"],
  ["U25", "未着が残っていても手持ちゼロで終了", "} else if (state.level !== 1 && allDone && state.nextPoolIndex >= state.pool.length) {", "} else if (state.level !== 1 && allDone) {"],
  ["U26", "Level 1 で Alt+数字のあと選択肢へフォーカスを移さない", "if (first && !pointer) first.focus();", "if (false) first.focus();"],
  ["U27", "優先度クリック直後に受信トレイのクリックも捨てる（scope 無視）", '&& !(area === "inbox" && gate.scope === "panel")) return false;', ") return false;"],
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctt-mut-"));
const results = [];
const env = (app) => ({ ...process.env, APP: app, JSON: "1", N: "1500" });

function run(cmd, args, app, timeoutMs) {
  const r = spawnSync(process.execPath, [path.join(__dirname, cmd), ...args], { env: env(app), encoding: "utf8", timeout: timeoutMs });
  return { code: r.status, out: (r.stdout || "").trim().split("\n").pop() || "", err: (r.stderr || "").slice(0, 200) };
}

const all = [...LOGIC_MUTANTS.map((m) => ({ kind: "Logic", m })), ...UI_MUTANTS.map((m) => ({ kind: "UI", m }))];
for (const { kind, m } of all) {
  const [id, desc, before, after] = m;
  if (ONLY && !ONLY.includes(id)) continue;
  const n = ORIGIN.split(before).length - 1;
  if (n !== 1) { results.push({ id, kind, desc, applied: false, note: `置換前が ${n} 箇所` }); continue; }
  const mutated = ORIGIN.replace(before, after);
  const file = path.join(tmpDir, `${id}.html`);
  fs.writeFileSync(file, mutated);
  const res = { id, kind, desc, applied: true, detectedBy: [] };
  if (kind === "Logic" || FULL) {
    // 終了コード 1 だけを「検出」とみなす。2 や null（ハーネス自体のエラー・タイムアウト）は検出ではなく error として記録する。
    const d = run("diff-check.js", [], file, 120000);
    res.diff = d.code === 0 ? "pass" : d.code === 1 ? "FAIL" : `error(${d.code}:${d.err})`;
    if (d.code === 1) res.detectedBy.push("差分");
    const g = run("golden.js", [], file, 120000);
    res.golden = g.code === 0 ? "pass" : g.code === 1 ? "FAIL" : `error(${g.code}:${g.err})`;
    if (g.code === 1) res.detectedBy.push("ゴールデン");
    const s = run("e2e07_data.js", [], file, 60000);
    res.e2e07 = s.code === 0 ? "pass" : s.code === 1 ? "FAIL" : `error(${s.code}:${s.err})`;
    if (s.code === 1) res.detectedBy.push("e2e07");
  }
  if (kind === "UI" || FULL) {
    let b = run("e2e10_audit.js", [], file, 400000);
    // 異常終了（クラッシュ）は 1 回だけ再実行する。再現すれば変異体が操作の流れを壊した証拠なので「異常終了で検出」として別集計する
    if (b.code !== 0 && b.code !== 1) b = run("e2e10_audit.js", [], file, 400000);
    res.e2e10 = b.code === 0 ? "pass" : b.code === 1 ? "FAIL" : `crash(${b.code}:${b.err.slice(0, 80)})`;
    if (b.code === 1) res.detectedBy.push("e2e10");
    else if (b.code !== 0) { res.detectedBy.push("e2e10(異常終了)"); res.crash = true; }
  }
  if ([res.diff, res.golden, res.e2e07, res.e2e10].some((v) => typeof v === "string" && v.startsWith("error"))) res.error = true;
  results.push(res);
  console.log(`${id} ${res.detectedBy.length ? "検出 " + res.detectedBy.join("+") : "未検出"}  ${desc}`);
}

const applied = results.filter((r) => r.applied);
const detected = applied.filter((r) => r.detectedBy.length);
console.log("\n==================== 変異検査 ====================");
console.log(`変異体 ${applied.length} 件（Logic ${applied.filter((r) => r.kind === "Logic").length} / UI ${applied.filter((r) => r.kind === "UI").length}）: 検出 ${detected.length} / 未検出 ${applied.length - detected.length}`);
const crashed = applied.filter((r) => r.crash);
if (crashed.length) console.log(`  うち e2e10 の異常終了で検出: ${crashed.length} 件（${crashed.map((r) => r.id).join(",")}）`);
for (const key of ["差分", "ゴールデン", "e2e07", "e2e10"]) {
  const hit = applied.filter((r) => r.detectedBy.some((d) => d.startsWith(key))).length;
  const tried = applied.filter((r) => (key === "e2e10" ? r.e2e10 !== undefined : r[key === "差分" ? "diff" : key === "ゴールデン" ? "golden" : "e2e07"] !== undefined)).length;
  console.log(`  ${key}: ${hit}/${tried}`);
}
const errored = applied.filter((r) => r.error);
if (errored.length) { console.log("ハーネスのエラー（検出とは数えない）:"); for (const r of errored) console.log(`  ${r.id} ${r.desc}: ${[r.diff, r.golden, r.e2e07, r.e2e10].filter((v) => typeof v === "string" && v.startsWith("error")).join(" ")}`); }
const missed = applied.filter((r) => !r.detectedBy.length);
if (missed.length) { console.log("未検出:"); for (const r of missed) console.log(`  ${r.id} ${r.desc}`); }
const skipped = results.filter((r) => !r.applied);
if (skipped.length) { console.log("適用できなかった変異体（置換前の文字列が見つからない／複数）:"); for (const r of skipped) console.log(`  ${r.id} ${r.desc}: ${r.note}`); }
fs.mkdirSync(path.join(__dirname, "_out"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "_out", "mutation.json"), JSON.stringify(results, null, 1));
