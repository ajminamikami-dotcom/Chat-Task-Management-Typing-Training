// e2e08 誤判定・理不尽さの排除（判定マトリクス総当たり）
// 対応要件: E 評価の因果対応 / CO 一因一罰 / CI 実行不能と誤答の非混同 / M 採点の決定性 / H 検証の対称性 / BX 後知恵評価の禁止
// 手法: 全31問 × 全操作（優先度3通り × 返信操作）を利用者と同じ経路で実行し、
//       アプリの正誤表示・CSV・結果画面を、正解表から独立に計算した期待値と突き合わせる。
"use strict";
const fs = require("fs");
const path = require("path");
const { open, sel, start, finish, findAnswer, activeChatBody, reporter, OUT_DIR } = require("./_lib");

async function readCsv(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(sel.csv)]);
  const fp = path.join(OUT_DIR, "judgment.csv");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await dl.saveAs(fp);
  const lines = fs.readFileSync(fp, "utf8").replace(/^﻿/, "").trim().split("\n");
  const cells = (l) => l.slice(1, -1).split('","').map((c) => c.replace(/""/g, '"'));
  const head = cells(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [head[i], v])));
}

async function openBySender(page, sender) {
  const items = page.locator(sel.chatItems);
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const t = await items.nth(i).innerText();
    if (t.startsWith(sender)) { await items.nth(i).click(); await page.waitForTimeout(80); return true; }
  }
  return false;
}

async function completedVerdict(page) {
  const t = await page.locator("#task-panel-content").innerText();
  return { prioOk: t.includes("優先度は正解"), replyOk: t.includes("返信処理は正解"), text: t.replace(/\s+/g, " ") };
}

(async () => {
  const R = reporter("e2e08_judgment");
  const { browser, page, errors, data } = await open();
  const P = ["high", "mid", "low"];
  const L = { high: "高", mid: "中", low: "低" };

  // ---------- Level 1: 11問 × 3優先度 × (3選択肢 + 返信せず) = 132 通り ----------
  R.section("Level 1 判定マトリクス（132通り）");
  let bad1 = 0, n1 = 0;
  for (const prio of P) {
    for (let act = 0; act < 4; act++) {                 // 0..2 = 選択肢, 3 = 返信せずに完了
      await page.click(sel.menu).catch(() => {});
      await start(page, 1);
      for (const a of data.L1) {
        await openBySender(page, a.sender);
        await page.click(sel.prio(prio)); await page.waitForTimeout(450);
        if (act === 3) await page.click(sel.noReply); else await page.click(sel.option(act));
        await page.waitForTimeout(60);
      }
      // 全件完了で自動終了。結果のCSVで判定を照合
      await page.waitForSelector(sel.result);
      const rows = await readCsv(page);
      for (const row of rows) {
        const a = data.L1.find((x) => x.sender === row["送信者"]);
        const expPrio = a.prio === prio;
        const expReply = act === 3 ? !a.req : (a.req && String(act) === a.copt);
        const gotPrio = row["優先度正誤"] === "正解", gotReply = row["返信正誤"] === "正解";
        n1++;
        if (gotPrio !== expPrio || gotReply !== expReply) {
          bad1++;
          R.ok(`E1-${a.sender}-${prio}-${act}`, false, `期待 優先度${expPrio ? "○" : "×"}/返信${expReply ? "○" : "×"} 実際 ${gotPrio ? "○" : "×"}/${gotReply ? "○" : "×"}`);
        }
      }
      // 結果画面の%が CSV から独立再計算した値と一致するか（要件E）
      const prioPct = Math.round(rows.filter((r) => r["優先度正誤"] === "正解").length / rows.length * 100);
      const replyPct = Math.round(rows.filter((r) => r["返信正誤"] === "正解").length / rows.length * 100);
      const score = (await page.locator(sel.score).innerText()).replace(/\s+/g, " ");
      const m = score.match(/優先度 (\S+) %.*返信 (\S+) %/);
      if (!(m && Number(m[1]) === prioPct && Number(m[2]) === replyPct)) R.ok(`E1-集計-${prio}-${act}`, false, `結果画面 ${score} / CSV再計算 優先度${prioPct}% 返信${replyPct}%`);
    }
  }
  R.ok("E1", bad1 === 0, `Level 1: ${n1} 判定中 誤判定 ${bad1} 件`);

  // ---------- Level 2: 20問 × 3優先度 × (正しい文を送信 / 返信せず) = 120 通り ----------
  R.section("Level 2 判定マトリクス（120通り）");
  let bad2 = 0, n2 = 0;
  for (const prio of P) {
    for (const act of ["reply", "no"]) {
      await page.click(sel.menu).catch(() => {});
      await start(page, 2, 300);                          // 5分: 約3分45秒で全20件が届く
      const seen = new Set(); const skipped = new Set();
      // 全20件が届くまで処理を続ける（届いた順に処理）
      const t0 = Date.now();
      while (seen.size < data.TY.length && Date.now() - t0 < 290000) {
        if (await page.locator(sel.phone).count()) await page.click(sel.ignore);
        const openItems = page.locator(sel.openChats);
        if (!(await openItems.count())) { await page.waitForTimeout(800); continue; }
        await openItems.first().click(); await page.waitForTimeout(60);
        const a = findAnswer(data, await activeChatBody(page), 2);
        seen.add(a.sender);
        await page.click(sel.prio(prio)); await page.waitForTimeout(450);
        if (act === "reply") {
          await page.locator(sel.input).fill("");
          await page.locator(sel.input).type(a.reply, { delay: 0 }); await page.waitForTimeout(50);
          if (await page.locator(sel.submit).isDisabled()) { R.ok(`H-${a.sender}`, false, "正しい文を入力しても送信不可: " + a.reply); skipped.add(a.sender); await page.click(sel.noReply); }
          else await page.click(sel.submit);
        } else await page.click(sel.noReply);
        await page.waitForTimeout(50);
      }
      await finish(page);
      const rows = await readCsv(page);
      for (const row of rows) {
        const a = data.TY.find((x) => x.sender === row["送信者"]);
        if (!a || row["状態"] !== "処理済" || skipped.has(a.sender)) continue;
        const expPrio = a.prio === prio;
        const expReply = act === "no" ? !a.req : a.req;
        const gotPrio = row["優先度正誤"] === "正解", gotReply = row["返信正誤"] === "正解";
        n2++;
        if (gotPrio !== expPrio || gotReply !== expReply) { bad2++; R.ok(`E2-${a.sender}-${prio}-${act}`, false, `期待 ${expPrio}/${expReply} 実際 ${gotPrio}/${gotReply}`); }
      }
      if (rows.length !== data.TY.length) R.ok(`BP-${prio}-${act}`, false, `CSV行数 ${rows.length} ≠ 20`);
    }
  }
  R.ok("E2", bad2 === 0, `Level 2: ${n2} 判定中 誤判定 ${bad2} 件`);

  // ---------- 理不尽さ: 入力判定の境界 ----------
  R.section("入力判定の境界（理不尽な不一致が無いか）");
  await page.click(sel.menu); await start(page, 2, 300);
  await page.locator(sel.chatItems).first().click(); await page.waitForTimeout(80);
  const a = findAnswer(data, await activeChatBody(page), 2);
  await page.click(sel.prio(a.prio)); await page.waitForTimeout(450);
  const tryText = async (txt) => { await page.locator(sel.input).fill(txt); await page.waitForTimeout(60); return !(await page.locator(sel.submit).isDisabled()); };
  R.ok("H-空白", await tryText(" " + a.reply + "　"), "前後の空白（全角含む）があっても一致する");
  R.ok("H-途中空白", await tryText(a.reply.slice(0, 3) + " " + a.reply.slice(3)), "途中に空白を入れても一致する");
  R.ok("H-一字欠け", !(await tryText(a.reply.slice(0, -1))), "最後の1文字が欠けると送信できない");
  R.ok("H-一字違い", !(await tryText(a.reply.slice(0, -2) + "x" + a.reply.slice(-1))), "1文字違うと送信できない");
  R.ok("H-過剰", !(await tryText(a.reply + "。")), "余分な文字があると送信できない");
  await page.locator(sel.input).fill(a.reply.slice(0, -1));
  await page.waitForTimeout(60);
  const fb = await page.locator("#typing-feedback").innerText();
  R.ok("K-進捗", /一致 \d+\/\d+ 文字/.test(fb), "未一致時に一致文字数が示される: " + fb);
  await page.locator(sel.input).fill(a.reply); await page.waitForTimeout(60);
  R.ok("K-一致", (await page.locator("#typing-feedback").innerText()).includes("一致しました"), "一致時に送信可能と示される");

  // ---------- CI 実行不能と誤答の非混同: 未完了は不正解に数えない ----------
  R.section("CI 未完了は誤答として採点されない");
  await page.click(sel.finish); await page.waitForSelector(sel.result);
  const rows = await readCsv(page);
  const unfinished = rows.filter((r) => r["状態"] !== "処理済");
  R.ok("CI-1", unfinished.every((r) => r["優先度正誤"] === "" && r["返信正誤"] === ""), `未完了 ${unfinished.length} 件の正誤欄が空`);
  const score = (await page.locator(sel.score).innerText()).replace(/\s+/g, " ");
  R.ok("CI-2", /優先度 - /.test(score) && /返信 - /.test(score), "完了0件なら % ではなく「-」: " + score);

  // ---------- CO 一因一罰 ----------
  R.section("CO 一因一罰（1つの誤りは1箇所だけ減点）");
  await page.click(sel.menu); await start(page, 1);
  const first = data.L1.find((d) => d.req);
  await openBySender(page, first.sender);
  const wrongPrio = P.find((p) => p !== first.prio);
  await page.click(sel.prio(wrongPrio)); await page.waitForTimeout(450);
  await page.click(sel.option(Number(first.copt))); await page.waitForTimeout(80);
  await openBySender(page, first.sender);
  let v = await completedVerdict(page);
  R.ok("CO-1", !v.prioOk && v.replyOk, "優先度だけ誤り → 優先度のみ不正解、返信は正解: " + v.text);
  const second = data.L1.find((d) => d.req && d.sender !== first.sender);
  await openBySender(page, second.sender);
  await page.click(sel.prio(second.prio)); await page.waitForTimeout(450);
  await page.click(sel.noReply); await page.waitForTimeout(80);
  await openBySender(page, second.sender);
  v = await completedVerdict(page);
  R.ok("CO-2", v.prioOk && !v.replyOk, "返信だけ誤り → 返信のみ不正解、優先度は正解: " + v.text);

  // ---------- M 決定性 ----------
  R.section("M 採点の決定性（同じ操作 → 同じ結果）");
  const runs = [];
  for (let k = 0; k < 2; k++) {
    await page.click(sel.menu).catch(() => {}); if (!(await page.locator(sel.start).count())) { await finish(page); await page.click(sel.menu); }
    await start(page, 1);
    for (const d of data.L1) { await openBySender(page, d.sender); await page.click(sel.prio("mid")); await page.waitForTimeout(450); await page.click(sel.option(1)); await page.waitForTimeout(50); }
    await page.waitForSelector(sel.result);
    runs.push((await page.locator(sel.score).innerText()).replace(/平均処理[\s\S]*/, "").replace(/\s+/g, " "));
  }
  R.ok("M-1", runs[0] === runs[1], `2回とも同一: ${runs[0]}`);

  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
