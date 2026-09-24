// e2e10 プレイアビリティ監査（V8）で確認された不具合の再発防止
// 8観点の独立監査 → 反証検証で「本物」と確認された 30 件を、利用者と同じ操作で1件ずつ固定する。
// 対応要件: O/V 一時停止の無害性 / AX 着信の記録 / L 誤操作からの回復 / K 結果の可知性 / AD フォーカスの閉じ込め /
//           AA 判定基準からの導出可能性 / E 集計の正しさ / AI CSV / AE 到達性
"use strict";
const { open, sel, start, finish, finishNow, dismissPhone, clickNoReply, findAnswer, activeChatBody, counters, scoreText, loadApp, reporter } = require("./_lib");

const ORIGIN = loadApp().html;
// 着信・新着の間隔を短くしたコピー（本体は触らない）
const fastHtml = (phoneMs, chatMs) => ORIGIN
  .replace(/function phoneInterval\(\) \{[\s\S]*?\n  \}/, `function phoneInterval() { return ${phoneMs}; }`)
  .replace(/function typingChatInterval\(\) \{[\s\S]*?\n  \}/, `function typingChatInterval() { return ${chatMs}; }`);

const active = (page) => page.evaluate(() => { const e = document.activeElement; return e ? (e.id || e.className || e.tagName) : "none"; });
// 返信必要のチャットを開く。手持ちに無ければ新着を待つ（出題順は無作為なので、最初の4件が全部返信不要のこともある）。
async function openReplyChat(page, data, level, waitMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    if (await page.locator(sel.phone).count()) await dismissPhone(page, false);
    const n = await page.locator(sel.openChats).count();
    for (let i = 0; i < n; i++) {
      await page.locator(sel.openChats).nth(i).click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(120);
      const a = findAnswer(data, await activeChatBody(page), level);
      if (a && a.req) return a;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("返信必要のチャットが届かない");
}
async function waitPhone(page, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.locator(sel.phone).count()) return true; await page.waitForTimeout(100); }
  return false;
}
// CDP でキーの自動リピート（長押し）を再現する
async function holdEnter(page, times = 6) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  for (let i = 0; i < times; i++) {
    await page.waitForTimeout(40);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", autoRepeat: true });
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.detach();
}

(async () => {
  const R = reporter("e2e10_audit");
  const { browser, page, errors, data, context } = await open();

  // ---------------------------------------------------------------- 判定基準とデータ（#5 #17）
  R.section("AA 判定基準から答えが導ける（#5 #17）");
  {
    const rules = await page.locator("[aria-labelledby='criteria-title']").innerText();
    R.ok("AA-中", rules.includes("会議・予定の変更"), "判定基準の「中」に会議・予定の変更がある（A社・田中部長の中が導ける）");
    R.ok("AA-低", rules.includes("急ぎではない"), "判定基準の「低」に『急ぎではない』と書かれた軽い依頼がある");
    R.ok("AA-返信", rules.includes("内容が情報共有でも返信"), "個人からの声かけは情報共有でも返信する、と明記");
    R.ok("AA-電話", rules.includes("営業の電話や誘いの電話は無視"), "電話の判定基準が画面にある");
    const t = (s) => data.L1.concat(data.TY).find((d) => d.sender === s).text;
    R.ok("AA-停電", /切ってください/.test(t("全社通知")) && data.L1.find((d) => d.sender === "全社通知").prio === "mid", "停電通知は対応事項（PCの電源）があるので「中」が導ける");
    R.ok("AA-障害", /至急対応してください/.test(t("サーバー監視")), "サーバー監視は依頼文があるので返信必要が導ける");
    R.ok("AA-研修", /受講してください/.test(t("人事部")), "人事部リマインドは依頼文があるので返信必要が導ける");
    const mail = data.TY.find((d) => d.sender === "システム通知");
    R.ok("AA-メール", /急ぎではありません/.test(mail.text) && mail.prio === "low", "システム通知（Level 2/3）は『急ぎではない』とあるので「低」が導ける");
  }

  // ---------------------------------------------------------------- 入力の一致表示（#4 #47 #49 #24）
  R.section("K 入力の一致表示が実態と合う（#4 #47 #49）");
  await start(page, 2, 600);
  let a = await openReplyChat(page, data, 2);
  await page.click(sel.prio(a.prio)); await page.waitForTimeout(800);
  R.ok("K-初期無効", (await page.locator(sel.submit).getAttribute("aria-disabled")) === "true", "何も打っていない直後の送信ボタンは無効表示");
  await page.locator(sel.input).fill(a.reply + "。"); await page.waitForTimeout(80);
  {
    const fb = await page.locator("#typing-feedback").innerText();
    const fill = await page.evaluate(() => document.querySelector(".progress-fill").style.width);
    R.ok("K-余分", /文字が多すぎます/.test(fb) && fill !== "100%" && (await page.locator("#target-text .wrong").count()) === 1, `1文字多いと理由が示され100%にならない: ${fb} / ${fill}`);
  }
  await page.locator(sel.input).fill(a.reply.slice(0, 2) + "x" + a.reply.slice(3)); await page.waitForTimeout(80);
  R.ok("K-前方一致", (await page.locator("#target-text .typed").count()) === 2 && /赤い文字/.test(await page.locator("#typing-feedback").innerText()), "誤りの後ろが偶然一致しても緑にならず、直す位置が示される");
  await page.locator(sel.input).fill(a.reply.replace(/。/g, "．").replace(/、/g, "，")); await page.waitForTimeout(80);
  R.ok("K-句読点", /送信できます/.test(await page.locator("#typing-feedback").innerText()), "IME の句読点設定が「，．」でも一致する");
  {
    const cdp = await context.newCDPSession(page);
    await page.locator(sel.input).fill(""); await page.locator(sel.input).focus();
    await cdp.send("Input.imeSetComposition", { text: "しょうち", selectionStart: 4, selectionEnd: 4 }); await page.waitForTimeout(80);
    R.ok("K-変換中", (await page.locator("#target-text .wrong").count()) === 0, "IME 変換中（未確定）の文字を誤り（赤）として表示しない");
    await cdp.send("Input.insertText", { text: a.reply.slice(0, 2) }); await page.waitForTimeout(80);
    R.ok("K-確定後", (await page.locator("#target-text .typed").count()) === 2, "確定した時点で一致表示が更新される");
    // IME の確定 Enter（isComposing）では送信されない（原則 5 の例外規則）
    await page.locator(sel.input).fill(a.reply.slice(0, -1)); await page.locator(sel.input).focus(); await page.waitForTimeout(60);
    await cdp.send("Input.imeSetComposition", { text: a.reply.slice(-1), selectionStart: 1, selectionEnd: 1 }); await page.waitForTimeout(60);
    const cBefore = await counters(page);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send("Input.insertText", { text: a.reply.slice(-1) });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229 });
    await page.waitForTimeout(120);
    R.ok("K-IME確定Enter", (await counters(page)).completed === cBefore.completed && /送信できます/.test(await page.locator("#typing-feedback").innerText()), "IME の確定 Enter では送信されず、確定後は一致表示になる");
    await cdp.detach();
    // 入力欄で Esc を押しても一時停止にならない（IME の取り消し操作）
    await page.locator(sel.input).focus(); await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    R.ok("K-入力欄Esc", (await page.locator("#pause-overlay.show").count()) === 0, "入力欄の Esc は一時停止にならない");
    // マウスで優先度を押した直後（0.4 秒以内）でも Enter 送信は受け付ける（原則 5）
    await page.click(sel.redo); await page.waitForTimeout(100);
    const box = await page.locator(sel.prio(a.prio)).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(60);
    await page.locator(sel.input).fill(a.reply); const cK = await counters(page);
    await page.keyboard.press("Enter"); await page.waitForTimeout(150);
    R.ok("K-マウス直後Enter", (await counters(page)).completed === cK.completed + 1, "マウスで優先度を押した 0.4 秒以内でも Enter 送信は受け付ける");
    a = await openReplyChat(page, data, 2);
    await page.click(sel.prio(a.prio)); await page.waitForTimeout(800);
  }

  // ---------------------------------------------------------------- Tab の着地・送信ボタン・返信せずに完了（#25 #31）
  R.section("L 打ち終えた直後の Tab / 誤クリックで不正解が確定しない（#25 #31）");
  await page.locator(sel.input).fill(a.reply.slice(0, -1)); await page.waitForTimeout(80);
  await page.locator(sel.input).focus(); await page.keyboard.press("Tab");
  R.ok("L-Tab", (await active(page)) === "submit-reply-btn", "不一致でも Tab の着地先は送信ボタン（「返信せずに完了」に飛ばない）");
  let c0 = await counters(page);
  await page.keyboard.press("Enter"); await page.waitForTimeout(120);
  R.ok("L-無効送信", (await counters(page)).completed === c0.completed && /一致していません/.test(await page.locator("#toast").innerText()) && (await active(page)) === "typing-input", "無効な送信は理由をトーストで示し入力欄に戻す");
  await page.click(sel.noReply); await page.waitForTimeout(80);
  R.ok("L-返信せず1", (await counters(page)).completed === c0.completed && /もう一度/.test(await page.locator(sel.noReply).innerText()), "下書きがあるときの「返信せずに完了」は1回では確定しない");
  await page.locator(sel.input).type("あ"); await page.waitForTimeout(60);
  R.ok("L-返信せず解除", (await page.locator(sel.noReply).innerText()) === "返信せずに完了", "入力を続けると確認状態が解除される");
  await page.click(sel.noReply); await page.waitForTimeout(80); await page.click(sel.noReply); await page.waitForTimeout(120);
  R.ok("L-返信せず2", (await counters(page)).completed === c0.completed + 1, "2回押せば完了できる（意図した操作は妨げない）");

  // ---------------------------------------------------------------- 再選択直後の Enter（#9）・完了後のフォーカス（#23）
  R.section("K/AD 再選択直後の Enter・完了後のフォーカス（#9 #23）");
  a = await openReplyChat(page, data, 2);
  await page.keyboard.press("Alt+Digit1"); await page.waitForTimeout(80);
  R.ok("AD-Alt後", (await active(page)) === "typing-input", "Alt+数字で優先度を選ぶと入力欄にフォーカスが入る");
  await page.locator(sel.input).fill(a.reply); await page.waitForTimeout(60);
  await page.locator(sel.chatItems).nth(1).click(); await page.waitForTimeout(60);
  // 元のチャット（保留）を開き直して 30ms 後に Enter
  const pendingIdx = await page.evaluate(() => Array.from(document.querySelectorAll("#chat-list .chat-item")).findIndex((e) => /保留/.test(e.textContent)));
  await page.locator(sel.chatItems).nth(pendingIdx).click(); await page.waitForTimeout(30);
  R.ok("K-開き直し有効", (await page.locator(sel.submit).getAttribute("aria-disabled")) === "false", "一致済みの下書きで開き直すと送信ボタンは有効表示");
  c0 = await counters(page);
  await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  R.ok("K-再選択Enter", (await counters(page)).completed === c0.completed + 1, "開き直した直後 0.4 秒以内でも Enter 送信が無視されない（キー操作にガードを掛けない）");
  R.ok("AD-完了後", /chat-item/.test(await active(page)), "完了後のフォーカスは次の未完了チャット（Tab が「終了」に飛ばない）");
  await page.keyboard.press("Tab"); R.ok("AD-完了後Tab", (await active(page)) !== "finish-btn", "完了直後の Tab が「終了」に当たらない");


  // ---------------------------------------------------------------- Level 1 ゆっくりダブルクリック（#22）
  R.section("L Level 1 の優先度ボタンをゆっくりダブルクリックしても返信が確定しない（#22）");
  await finish(page); await page.click(sel.menu); await start(page, 1);
  await page.locator(sel.chatItems).first().click(); await page.waitForTimeout(120);
  {
    const box = await page.locator(sel.prio("mid")).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    c0 = await counters(page);
    await page.mouse.click(x, y); await page.waitForTimeout(480); await page.mouse.click(x, y); await page.waitForTimeout(120);
    R.ok("L-遅い2回目", (await counters(page)).completed === c0.completed && (await page.locator(sel.option(0)).count()) === 1, "0.48秒後の同じ場所への2回目クリックは返信として確定しない");
    await page.waitForTimeout(400); await page.mouse.click(x, y); await page.waitForTimeout(120);
    R.ok("L-意図した選択", (await counters(page)).completed === c0.completed + 1, "0.7秒を過ぎた同じ場所のクリックは通る（意図した選択を妨げない）");
    // 別の場所（優先度と重ならない「返信せずに完了」）は直後でも通る
    await page.locator(sel.openChats).first().click(); await page.waitForTimeout(120);
    await page.click(sel.prio("low")); await page.waitForTimeout(430);
    c0 = await counters(page);
    await page.click(sel.noReply); await page.waitForTimeout(120);
    R.ok("L-別位置", (await counters(page)).completed === c0.completed + 1, "優先度と重ならないボタンは 0.43 秒後でも押せる");
  }
  await finish(page); await page.click(sel.menu);

  // ---------------------------------------------------------------- 終了の確認（#7）・結果画面の離脱確認（#44）・未着（#48）・CSV（#45）
  R.section("L 終了は確認つき／結果画面でも離脱確認／未着が分かる（#7 #44 #48 #45）");
  await start(page, 2, 600);
  await page.click(sel.finish); await page.waitForTimeout(120);
  R.ok("L-終了確認", (await page.locator(sel.result).count()) === 0 && (await page.locator(sel.finishConfirm).isVisible()) && (await active(page)) === "finish-cancel-btn", "「終了」1回では終わらず、確認画面（既定フォーカスは「続ける」）が出る");
  await page.keyboard.press("Escape"); await page.waitForTimeout(120);
  R.ok("L-終了取消", (await page.locator(sel.game).count()) === 1 && (await page.locator("#pause-overlay.show").count()) === 0 && (await page.locator(sel.timer).innerText()) === "10:00", "Esc で取り消すと停止分を引かずに続きから再開できる");
  // 開き直しても最初に開いた時刻を保つ（CSV の確認時間）: 最初に開いてから 1.5 秒後に別のチャットを見て戻る
  await page.waitForTimeout(450);   // 再開直後 0.4 秒はマウスクリックを受け付けない仕様
  await page.locator(sel.openChats).first().click(); await page.waitForTimeout(1500);
  await page.locator(sel.openChats).nth(1).click(); await page.waitForTimeout(100);
  await page.locator(sel.openChats).first().click(); await page.waitForTimeout(100);
  const firstOpened = findAnswer(data, await activeChatBody(page), 2);
  await page.click(sel.prio(firstOpened.prio)); await page.waitForTimeout(800);
  if (firstOpened.req) { await page.locator(sel.input).fill(firstOpened.reply); await page.keyboard.press("Enter"); } else await clickNoReply(page);
  await page.waitForTimeout(120);
  // 優先度を選び直しても最初の判断時刻が保たれる（#45）
  a = await openReplyChat(page, data, 2);
  await page.click(sel.prio(a.prio)); await page.waitForTimeout(800);
  await page.locator(sel.input).fill(a.reply); await page.waitForTimeout(1200);
  await page.click(sel.redo); await page.waitForTimeout(100); await page.click(sel.prio(a.prio)); await page.waitForTimeout(800);
  await page.keyboard.press("Enter"); await page.waitForTimeout(120);
  await finishNow(page); await page.waitForSelector(sel.result);
  R.ok("E-未着", /未着 16 件/.test(await page.locator("#result-subtitle").innerText()) && /16件のチャットが届く前に/.test(await page.locator("#insight-grid").innerText()), "手動終了で未着の件数が結果画面に出て、「上位レベルへ」と言わない");
  {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(sel.csv)]);
    const fs = require("fs"), path = require("path");
    const p = path.join(require("./_lib").OUT_DIR, "audit_L2.csv"); await dl.saveAs(p);
    const lines = fs.readFileSync(p, "utf8").replace(/^﻿/, "").split("\n");
    const head = lines[0].split(",").map((s) => s.replace(/"/g, ""));
    const done = lines.slice(1).map((l) => l.split('","').map((s) => s.replace(/"/g, ""))).find((r) => r[1] === "処理済");
    const col = (name) => done[head.indexOf(name)];
    R.ok("AI-列", head.includes("終了理由") && head.includes("未着件数") && col("終了理由") === "手動終了" && col("未着件数") === "16", "CSV に終了理由と未着件数が入る");
    R.ok("AI-選び直し", Number(col("返信時間(秒)")) >= 2.5, `選び直しても入力時間が返信時間に残る（返信 ${col("返信時間(秒)")} 秒 / 振り分け ${col("振り分け時間(秒)")} 秒）`);
    const firstRow = lines.slice(1).map((l) => l.split('","').map((s) => s.replace(/"/g, ""))).find((r) => r[2] === firstOpened.sender);
    const conf = Number(firstRow[head.indexOf("確認時間(秒)")]);
    R.ok("AI-確認時間", conf < 1.4, `開き直しても確認時間は最初に開いた時刻から（${conf} 秒。付け替わると 1.5 秒以上になる）`);
    R.ok("AI-名前", /_\d{8}_\d{4}\.csv$/.test(dl.suggestedFilename()), "ファイル名に時刻が入り同日の複数回で重ならない: " + dl.suggestedFilename());
  }
  R.ok("L-結果離脱", await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), "結果画面でも F5／戻るに離脱確認が出る");
  await page.click(sel.menu);
  R.ok("L-開始離脱なし", await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return !e.defaultPrevented; }), "スタート画面では離脱確認を出さない");

  // ---------------------------------------------------------------- 結果画面の助言（#20）
  R.section("E 結果の助言が誤りの内訳に合う（#20）");
  await start(page, 1);
  for (const d of data.L1) {
    const n = await page.locator(sel.openChats).count(); if (!n) break;
    await page.locator(sel.openChats).first().click(); await page.waitForTimeout(80);
    const x = findAnswer(data, await activeChatBody(page), 1);
    await page.click(sel.prio(x.prio)); await page.waitForTimeout(750);
    if (!x.req) await clickNoReply(page);
    else if (["田中部長", "総務部", "経理部"].includes(x.sender)) await clickNoReply(page);       // 返信必要を返信せず（3件）
    else await page.click(sel.option(Number(x.copt)));
    await page.waitForTimeout(80);
  }
  await page.waitForSelector(sel.result);
  {
    const t = await page.locator("#insight-grid").innerText();
    R.ok("E-助言", /依頼・質問・確認事項がある連絡/.test(t) && !/本文に「返信不要」があるか/.test(t), "返信必要を無視した誤りには「依頼には返信」の助言（返信不要の見落としと言わない）");
  }
  await page.click(sel.menu);

  // ---------------------------------------------------------------- 一時停止の無害性（#2 #6 #10）
  R.section("O/V 一時停止しても割り込みが増えず、停止時間が処理時間に入らない（#2 #6 #10）");
  await start(page, 3, 900);
  {
    const items0 = await page.locator(sel.chatItems).count();
    for (let i = 0; i < 5; i++) { await page.click(sel.pause); await page.waitForTimeout(150); await page.click(sel.resume); await page.waitForTimeout(150); }
    await page.waitForTimeout(3500);
    R.ok("V-停止連打", (await page.locator(sel.chatItems).count()) === items0 && (await page.locator(sel.phone).count()) === 0, "停止→再開を5回繰り返しても直後に新着・着信が来ない");
    // 停止時間の除外
    await page.locator(sel.openChats).first().click(); await page.waitForTimeout(120);
    a = findAnswer(data, await activeChatBody(page), 3);
    await page.click(sel.prio(a.prio)); await page.waitForTimeout(700);
    const timerBefore = await page.locator(sel.timer).innerText();
    await page.click(sel.pause); await page.waitForTimeout(3000);
    R.ok("V-停止中の時計", (await page.locator(sel.timer).innerText()) === timerBefore, `停止中は残り時間が進まない（${timerBefore}）`);
    // 停止中は Tab で背面へ抜けられない・選択も変わらない
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    R.ok("V-停止Tab", (await active(page)) === "resume-btn" && (await page.evaluate(() => document.querySelector(".game-shell").inert)) === true, "停止中は Tab が停止画面の中に留まり、背面は不活性");
    await page.keyboard.press("Escape"); await page.waitForTimeout(450);   // 再開直後 0.4 秒はマウスクリックを受け付けない仕様
    {
      const [m0, s0] = timerBefore.split(":").map(Number);
      const [m1, s1] = (await page.locator(sel.timer).innerText()).split(":").map(Number);
      const diff = (m0 * 60 + s0) - (m1 * 60 + s1);
      R.ok("V-再開後の時計", diff >= 0 && diff <= 2, `再開後は停止前の続きから進む（停止 3 秒＋再開 0.45 秒で減った表示は ${diff} 秒）`);
    }
    if (a.req) { await page.locator(sel.input).fill(a.reply); await page.keyboard.press("Enter"); } else await clickNoReply(page);
    await page.waitForTimeout(120);
    await finish(page);
    const s = await scoreText(page);
    const avg = Number((s.match(/平均処理 ([\d.]+)/) || [])[1]);
    R.ok("V-停止時間", avg < 2.5, `3秒停止しても平均処理に含まれない（平均処理 ${avg} 秒）`);
    await page.click(sel.menu);
  }

  // ---------------------------------------------------------------- 着信まわり（#1 #3 #11 #14 #15 #16 #34 #41 #42 #43）
  R.section("AX/AD 着信の記録と操作の閉じ込め（#1 #3 #11 #15 #34 #41 #42 #43）");
  await browser.close();
  const fast = await open({ html: fastHtml(1500, 4000) });
  const p2 = fast.page;
  await start(p2, 3, 600);
  a = await openReplyChat(p2, data, 3);
  await p2.click(sel.prio(a.prio)); await p2.waitForTimeout(800);
  R.ok("AX-着信", await waitPhone(p2), "着信が来る（短縮コピー）");
  {
    R.ok("AD-初期焦点", (await active(p2)) === "phone-card", "着信の初期フォーカスはボタンではなく着信画面（入力中の Enter/Space が応答にならない）");
    // 表示直後の Enter/Space は無視
    await p2.keyboard.press("Tab"); await p2.keyboard.press("Enter"); await p2.keyboard.press("Space"); await p2.waitForTimeout(100);
    R.ok("AX-直後無視", (await p2.locator(sel.phone).count()) === 1, "表示から 0.5 秒以内の Enter/Space では応答にならない");
    // 背面クリック不可（inert）
    R.ok("AD-背面", (await p2.evaluate(() => document.querySelector(".game-shell").inert)) === true, "着信中は背面が不活性");
    // 着信中の Alt+数字は背面に届かない
    {
      const badgesBefore = await p2.locator("#chat-list .chat-item").allInnerTexts();
      await p2.keyboard.press("Alt+Digit1"); await p2.waitForTimeout(100);
      R.ok("AD-着信中Alt", JSON.stringify(await p2.locator("#chat-list .chat-item").allInnerTexts()) === JSON.stringify(badgesBefore) && (await p2.locator(sel.phone).count()) === 1, "着信中に Alt+数字 を押しても背面の優先度は変わらない");
    }
    // Shift+Tab でも背面へ抜けない
    await p2.evaluate(() => document.body.focus()); await p2.keyboard.press("Shift+Tab");
    R.ok("AD-ShiftTab", ["answer-phone-btn", "ignore-phone-btn", "phone-pause-btn"].includes(await active(p2)), "本文クリック後の Shift+Tab でも着信画面の中に留まる");
    // 着信中に一時停止ボタン → 再開しても相手が変わらない（#1）、再開ダブルクリックで判定が落ちない（#42）
    await p2.waitForTimeout(600);
    const who = await p2.locator("#caller-name").innerText();
    await p2.click(sel.phonePause); await p2.waitForTimeout(150);
    R.ok("O-着信中停止", (await p2.locator("#pause-overlay.show").count()) === 1 && (await p2.locator(sel.phone).count()) === 0, "着信画面のボタンで一時停止できる");
    const rb = await p2.locator(sel.resume).boundingBox();
    await p2.mouse.dblclick(rb.x + rb.width / 2 - 15, rb.y + rb.height / 2); await p2.waitForTimeout(2600);
    R.ok("AX-再開2回", (await p2.locator(sel.phone).count()) === 1 && (await p2.locator("#caller-name").innerText()) === who, "再開のダブルクリックで判定が落ちず、2.2秒後も相手が差し替わらない");
    // Enter 長押しで応答にならない（#43 系）
    await p2.locator(sel.ignore).focus();
    const c1 = await counters(p2);
    await holdEnter(p2, 6); await p2.waitForTimeout(200);
    R.ok("L-長押し", (await counters(p2)).completed === c1.completed, "「無視する」を Enter 長押ししても復帰先のボタンが押されない");
    // 無視後のフォーカス復帰（#16 系）：入力欄へ戻る
    if (await p2.locator(sel.phone).count()) await dismissPhone(p2, false);
    R.ok("AD-無視復帰", (await active(p2)) === "typing-input", "無視した後は入力欄に戻る");
  }
  // #43 の経路そのもの: 着信前のフォーカスが「返信せずに完了」→「無視する」を Enter 長押し → リピートが復帰先を押さない
  {
    await p2.locator(sel.noReply).focus();
    R.ok("AX-着信b", await waitPhone(p2), "着信（長押し検査用）");
    await p2.waitForTimeout(600);
    await p2.locator(sel.ignore).focus();
    const c1 = await counters(p2);
    await holdEnter(p2, 8); await p2.waitForTimeout(250);
    R.ok("L-長押し2", (await counters(p2)).completed === c1.completed && (await p2.locator(sel.phone).count()) === 0, "復帰先が「返信せずに完了」でも Enter 長押しで完了にならない");
    // 「再開」の Enter 長押し → 再開後に入力欄へ戻ったリピート Enter が下書きを送信しない
    const b = findAnswer(data, await activeChatBody(p2), 3);
    if (b && b.req) {
      await p2.locator(sel.input).fill(b.reply); await p2.waitForTimeout(80);
      await p2.click(sel.pause); await p2.waitForTimeout(150);
      const c2 = await counters(p2);
      await p2.locator(sel.resume).focus();
      await holdEnter(p2, 8); await p2.waitForTimeout(250);
      R.ok("L-長押し3", (await counters(p2)).completed === c2.completed && (await p2.locator("#pause-overlay.show").count()) === 0, "「再開」を Enter 長押ししても、再開後のリピート Enter で下書きが送信されない");
    }
  }
  // 応答後のフォーカス（#15）／閉じた直後のダブルクリック（#41）
  R.ok("AX-次の着信", await waitPhone(p2), "次の着信が来る");
  {
    await p2.waitForTimeout(600);
    const ib = await p2.locator(sel.ignore).boundingBox();
    const c1 = await counters(p2);
    await p2.mouse.dblclick(ib.x + ib.width / 2, ib.y + ib.height / 2); await p2.waitForTimeout(200);
    R.ok("L-無視連打", (await counters(p2)).completed === c1.completed && (await p2.locator(sel.phone).count()) === 0, "「無視する」のダブルクリックで背面の完了ボタンが押されない");
  }
  R.ok("AX-3回目", await waitPhone(p2), "3回目の着信");
  await dismissPhone(p2, true);
  R.ok("AD-応答後", /chat-item|inbox-title/.test(await active(p2)), "応答した後は受信トレイにフォーカスが移る（Tab が終了に飛ばない）");
  await finish(p2);
  {
    const s = await scoreText(p2);
    R.ok("AX-件数", /電話判断 \d+ %/.test(s), "電話判断が集計される: " + s);
  }
  await fast.browser.close();

  // ---------------------------------------------------------------- 未着が残る間は全件完了で終了しない／Level 1 の Alt+数字
  R.section("AF 未着が残る間は手持ちゼロでも終了しない／Level 1 のキーボード経路");
  {
    const f3 = await open({ html: fastHtml(60000, 6000) });
    const p5 = f3.page;
    await start(p5, 2, 600);
    // 優先度をマウスで押した直後でも、受信トレイの別チャットのクリックは通る（門番の scope）
    await p5.locator(sel.openChats).first().click(); await p5.waitForTimeout(120);
    {
      const box = await p5.locator(sel.prio("mid")).boundingBox();
      await p5.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p5.waitForTimeout(150);
      const headingBefore = await p5.locator("#chat-heading").innerText();
      await p5.locator(sel.openChats).nth(1).click(); await p5.waitForTimeout(120);
      R.ok("L-優先度直後の受信トレイ", (await p5.locator("#chat-heading").innerText()) !== headingBefore, "優先度をマウスで押した 0.2 秒後でも受信トレイの別チャットを開ける");
      await p5.waitForTimeout(800);
    }
    for (let i = 0; i < 4; i++) { const r = await require("./_lib").solveOne(p5, data, "ideal"); if (r === false) break; }
    await p5.waitForTimeout(400);
    R.ok("AF-未着待ち", (await p5.locator(sel.result).count()) === 0 && (await p5.locator(sel.openChats).count()) === 0, "初期4件を処理しても未着が残る間は結果画面に行かない");
    await p5.waitForTimeout(6500);
    R.ok("AF-次の新着", (await p5.locator(sel.openChats).count()) >= 1, "そのまま待てば次の新着が届く");
    await finish(p5); await p5.click(sel.menu);
    await start(p5, 1);
    await p5.locator(sel.chatItems).first().focus(); await p5.keyboard.press("Enter"); await p5.waitForTimeout(100);
    await p5.keyboard.press("Alt+Digit1"); await p5.waitForTimeout(80);
    R.ok("AD-L1 Alt後", (await active(p5)) === "choice-btn", "Level 1 で Alt+数字により優先度を選ぶと最初の選択肢にフォーカスが入る");
    f3.errors.forEach((e) => errors.push(e));
    await f3.browser.close();
  }

  // ---------------------------------------------------------------- IME 変換中の着信を先送り（#14）
  R.section("AD IME 変換中は着信を少し待つ（#14）／再開直後のクリックで別チャットに切り替わらない（批評者候補）");
  {
    const f2 = await open({ html: fastHtml(1200, 4000), viewport: { width: 1024, height: 768 } });
    const p3 = f2.page;
    await start(p3, 3, 600);
    const b = await openReplyChat(p3, data, 3);
    await p3.click(sel.prio(b.prio)); await p3.waitForTimeout(300);
    // 最初の着信を捌いてから、次の着信（1.2秒後）までに変換中の状態を作る
    R.ok("AD-着信1", await waitPhone(p3), "着信が来る");
    await dismissPhone(p3, false);
    const cdp = await f2.context.newCDPSession(p3);
    await p3.locator(sel.input).focus();
    await cdp.send("Input.imeSetComposition", { text: "しょうち", selectionStart: 4, selectionEnd: 4 });
    await p3.waitForTimeout(1500);
    const during = await p3.locator(sel.phone).count();
    await cdp.send("Input.insertText", { text: "承知" });
    await p3.waitForTimeout(700);
    R.ok("AD-変換中先送り", during === 0 && (await p3.locator(sel.phone).count()) === 1, `変換中は着信が先送りされ（変換中の着信 ${during}）、確定後に鳴る`);
    await cdp.detach();
    await dismissPhone(p3, false);
    // 幅 1024（単一列）で「再開」をダブルクリックしても、2回目が受信トレイに落ちて別チャットに切り替わらない
    const headingBefore = await p3.locator("#chat-heading").innerText();
    await p3.click(sel.pause); await p3.waitForTimeout(150);
    const rb = await p3.locator(sel.resume).boundingBox();
    await p3.mouse.dblclick(rb.x + rb.width / 2, rb.y + rb.height / 2); await p3.waitForTimeout(200);
    R.ok("L-再開2回", (await p3.locator("#pause-overlay.show").count()) === 0 && (await p3.locator("#chat-heading").innerText()) === headingBefore, "再開のダブルクリックで処理中のチャットが別チャットに切り替わらない");
    f2.errors.forEach((e) => errors.push(e));
    await f2.browser.close();
  }

  // ---------------------------------------------------------------- 表示（#8 #37）
  R.section("AE ゆったり表示と狭い結果画面の到達性（#8 #37）");
  {
    const b3 = await open({ viewport: { width: 1280, height: 720 } });
    const p4 = b3.page;
    await p4.click(sel.comfortable(true)); await start(p4, 2, 600);
    const c = await openReplyChat(p4, data, 2);
    await p4.click(sel.prio(c.prio)); await p4.waitForTimeout(500);
    const vis = await p4.evaluate(() => ["submit-reply-btn", "no-reply-btn", "typing-feedback"].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    R.ok("AE-ゆったり", vis, "1280×720 のゆったり表示で送信・完了ボタンと一致表示が画面内にある");
    // 返信必要の課題を誤った優先度で「返信せずに完了」→ 要確認タスクの表がある結果画面を作る
    await p4.click(sel.redo); await p4.waitForTimeout(100);
    await p4.click(sel.prio(c.prio === "high" ? "low" : "high")); await p4.waitForTimeout(800);
    await clickNoReply(p4);
    await finish(p4);
    await p4.setViewportSize({ width: 390, height: 844 }); await p4.waitForTimeout(200);
    R.ok("AE-結果390", await p4.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelectorAll("#review-table tbody tr").length > 0), "要確認タスクの表があっても幅 390px で結果画面が横にはみ出さない");
    await p4.evaluate(() => document.body.classList.remove("comfortable"));
    b3.errors.forEach((e) => errors.push(e));
    await b3.browser.close();
  }

  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件 ${errors.slice(0, 3).join(" | ")}`);
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
