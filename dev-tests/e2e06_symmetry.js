// e2e06 対称性スイープ
// 「同じ操作」を全バリアント（レベル × 表示設定 × 制限時間 × 返信要/不要 × マウス/キーボード）で総当たりし、
// フェーズ構成・判定タイミング・後片付け・フィードバックが同形であることを検査する。
// 対応要件: AS 対話フローの均質性 / AW 判定タイミング / AZ 空状態 / BE 完了記録 / BO 終了理由 / BQ ショートカット / BR Enter/Space / BD 表示設定の不可侵
"use strict";
const { open, sel, start, finish, findAnswer, activeChatBody, counters, scoreText, reporter } = require("./_lib");

(async () => {
  const R = reporter("e2e06_symmetry");
  const { browser, page, errors, data } = await open();

  // ---------- AS/AW: 返信要 と 返信不要 が同じフェーズを通るか（レベル × 表示設定） ----------
  R.section("AS/AW フェーズ構成の均質性（レベル×表示設定×返信要否）");
  for (const comfortable of [false, true]) {
    await page.click(sel.comfortable(comfortable));
    for (const level of [1, 2, 3]) {
      await start(page, level, 300);
      const phases = {};
      for (const kind of ["req", "noreq"]) {
        // 目的のチャットを探して開く（届いていなければ待つ）
        let a = null;
        for (let tries = 0; tries < 40 && !a; tries++) {
          if (await page.locator(sel.phone).count()) await page.click(sel.ignore);
          const n = await page.locator(sel.openChats).count();
          for (let i = 0; i < n; i++) {
            await page.locator(sel.openChats).nth(i).click(); await page.waitForTimeout(60);
            const cand = findAnswer(data, await activeChatBody(page), level);
            if (cand && cand.req === (kind === "req")) { a = cand; break; }
          }
          if (!a) await page.waitForTimeout(1500);
        }
        if (!a) { R.ok(`AS-L${level}-${kind}`, false, "対象のチャットが届かなかった"); continue; }
        const p = [];
        p.push("開く:" + ((await page.locator(sel.prio("high")).count()) ? "優先度パネル" : "?"));
        // 開いて閉じただけでは判定されない（AW）
        const cBase = await counters(page);
        await page.locator(sel.openChats).first().click(); await page.waitForTimeout(40);
        const c0 = await counters(page);
        p.push("開閉で完了数:" + (c0.completed - cBase.completed));
        // 対象を開き直して優先度
        const n = await page.locator(sel.openChats).count();
        for (let i = 0; i < n; i++) { await page.locator(sel.openChats).nth(i).click(); await page.waitForTimeout(40); if ((await activeChatBody(page)).includes(a.text)) break; }
        await page.click(sel.prio(a.prio)); await page.waitForTimeout(450);
        p.push("優先度後:" + ((await page.locator(sel.option(0)).count()) ? "選択式" : (await page.locator(sel.input).count()) ? "入力式" : "?")
          + "+選び直し" + (await page.locator(sel.redo).count()) + "+返信せず" + (await page.locator(sel.noReply).count()));
        const c1 = await counters(page);
        p.push("優先度で完了数:" + (c1.completed - c0.completed));
        if (a.req) {
          if (level === 1) await page.click(sel.option(Number(a.copt)));
          else { await page.locator(sel.input).type(a.reply, { delay: 0 }); await page.waitForTimeout(60); await page.click(sel.submit); }
        } else await page.click(sel.noReply);
        await page.waitForTimeout(80);
        const c2 = await counters(page);
        p.push("完了操作で完了数:" + (c2.completed - c1.completed));
        p.push("完了後の選択:" + ((await page.locator("#chat-list .chat-item.active").count()) ? "残る" : "解除"));
        phases[kind] = p.join(" / ");
      }
      const same = phases.req && phases.noreq && phases.req.replace(/選択式|入力式/, "X") === phases.noreq.replace(/選択式|入力式/, "X");
      R.ok(`AS-L${level}-${comfortable ? "ゆったり" : "標準"}`, same, same ? phases.req : `返信要: ${phases.req} ≠ 返信不要: ${phases.noreq}`);
      await finish(page); await page.click(sel.menu);
    }
  }
  await page.click(sel.comfortable(false));

  // ---------- BQ/BR: マウス経路とキーボード経路の同形 ----------
  R.section("BQ/BR マウス操作とキーボード操作の均質性");
  const viaMouse = async () => {
    await start(page, 1);
    await page.locator(sel.chatItems).first().click(); await page.waitForTimeout(60);
    await page.click(sel.prio("high")); await page.waitForTimeout(450);
    await page.click(sel.option(0)); await page.waitForTimeout(60);
    const c = await counters(page); await finish(page); const s = await scoreText(page); await page.click(sel.menu); return { c, s };
  };
  const viaKeyboard = async () => {
    await start(page, 1);
    await page.locator(sel.chatItems).first().focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(60);
    await page.keyboard.press("Alt+Digit1"); await page.waitForTimeout(450);
    await page.locator(sel.option(0)).focus(); await page.keyboard.press("Space"); await page.waitForTimeout(60);
    const c = await counters(page); await page.locator(sel.finish).focus(); await page.keyboard.press("Enter"); await page.waitForSelector(sel.result);
    const s = await scoreText(page); await page.click(sel.menu); return { c, s };
  };
  const m = await viaMouse(), k = await viaKeyboard();
  R.ok("BQ-1", JSON.stringify(m.c) === JSON.stringify(k.c), `マウス ${JSON.stringify(m.c)} = キーボード ${JSON.stringify(k.c)}`);
  R.ok("BR-1", m.s === k.s, `結果も同一: ${k.s}`);

  // ---------- BD: 表示設定は処理・判定を変えない ----------
  R.section("BD 表示設定の不可侵性（ゆったりでも判定・記録が同じ）");
  const runL1 = async () => {
    await start(page, 1);
    for (const d of data.L1) {
      const n = await page.locator(sel.chatItems).count();
      for (let i = 0; i < n; i++) { if ((await page.locator(sel.chatItems).nth(i).innerText()).startsWith(d.sender)) { await page.locator(sel.chatItems).nth(i).click(); break; } }
      await page.click(sel.prio(d.prio)); await page.waitForTimeout(450);
      if (d.req) await page.click(sel.option(Number(d.copt))); else await page.click(sel.noReply);
      await page.waitForTimeout(40);
    }
    await page.waitForSelector(sel.result); const s = await scoreText(page); await page.click(sel.menu); return s.replace(/平均処理.*/, "");
  };
  await page.click(sel.comfortable(false)); const s1 = await runL1();
  await page.click(sel.comfortable(true)); const s2 = await runL1();
  await page.click(sel.comfortable(false));
  R.ok("BD-1", s1 === s2, `標準「${s1}」= ゆったり「${s2}」`);

  // ---------- BO: 終了理由 × レベル の結果画面が同形 ----------
  R.section("BO 終了理由×レベルで結果画面の構成が同じ");
  const shape = async () => ({
    cards: await page.locator("#score-grid .score-card").count(),
    insight: (await page.locator(sel.insight).innerText()).includes("よかった点") && (await page.locator(sel.insight).innerText()).includes("次の練習"),
    review: (await page.locator(sel.review).innerText()).length > 0,
    buttons: [await page.locator(sel.csv).isVisible(), await page.locator(sel.retry).isVisible(), await page.locator(sel.menu).isVisible()].every(Boolean),
  });
  const shapes = [];
  for (const level of [1, 2, 3]) {
    await start(page, level, 300); await page.click(sel.finish); await page.waitForSelector(sel.result);
    shapes.push({ level, how: "手動", ...(await shape()) }); await page.click(sel.menu);
  }
  await start(page, 1); for (const d of data.L1) { const n = await page.locator(sel.openChats).count(); if (!n) break; await page.locator(sel.openChats).first().click(); await page.click(sel.prio("mid")); await page.waitForTimeout(450); await page.click(sel.noReply); await page.waitForTimeout(30); }
  await page.waitForSelector(sel.result); shapes.push({ level: 1, how: "全件完了", ...(await shape()) }); await page.click(sel.menu);
  const base = { insight: true, review: true, buttons: true };
  const bad = shapes.filter((s) => !(s.insight && s.review && s.buttons && s.cards === (s.level === 3 ? 5 : 4)));
  R.ok("BO-1", bad.length === 0, bad.length ? JSON.stringify(bad) : `${shapes.length} 通りすべてで スコアカード(L3は電話込み)・よかった点・次の練習・要確認・3ボタン が揃う`);

  // ---------- AZ: 空状態 ----------
  R.section("AZ 空状態表示の均質性");
  await start(page, 1); for (const d of data.L1) { const n = await page.locator(sel.openChats).count(); if (!n) break; await page.locator(sel.openChats).first().click(); const a = findAnswer(data, await activeChatBody(page), 1); await page.click(sel.prio(a.prio)); await page.waitForTimeout(450); if (a.req) await page.click(sel.option(Number(a.copt))); else await page.click(sel.noReply); await page.waitForTimeout(30); }
  await page.waitForSelector(sel.result);
  R.ok("AZ-1", (await page.locator(sel.review).innerText()).includes("要確認タスクはありません"), "全問正解時の要確認タスクに案内文が出る");
  await page.click(sel.menu); await start(page, 2, 300);
  R.ok("AZ-2", (await page.locator("#message-stage").innerText()).includes("選択してください"), "未選択時に案内文が出る");
  await finish(page);

  R.ok("JS", errors.length === 0, `JSエラー ${errors.length} 件`);
  await browser.close();
  await R.done(errors);
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(2); });
