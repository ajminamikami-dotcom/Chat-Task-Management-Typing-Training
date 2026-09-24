# 判定・集計・表示文 仕様書（Logic 仕様）

このアプリ「チャットタスク管理・タイピングトレーニング」の、判定・集計・結果画面の文言・CSV・入力一致に関わる規則を **表と手順** で定義する。
本体（HTML 内の `Logic` ブロック）と、参照実装（`dev-tests/ref/*.js`）は、どちらも **この文書だけ** から実装できなければならない。
本体と参照実装は `dev-tests/diff-check.js` で乱数入力 10,000 件を突き合わせ、全出力が一致することを確認する（差分検査）。

- 用語: 「チャット」= 受信トレイの1件。「お手本」= Level 2/3 で入力する返信文。
- 文字列は **1文字でも違えば不一致** として扱う（全角スペース・句読点・末尾の「。」を含む）。
- 数値の丸めは JavaScript の `Math.round`（0.5 は正の無限大方向）と `Number.prototype.toFixed(1)` に従う。
- 文字数は UTF-16 コード単位で数える（現在のお手本にサロゲートペアや結合文字は無い。含める場合はこの仕様を見直す）。
- 「真」「偽」は JavaScript の truthy / falsy。完了したチャットの isPrioCorrect / isReplyCorrect は必ず boolean、selectedPrio は必ず設定済み。
- 前提条件: normalize の value は文字列（null / undefined / "" は ""）、formatTime の sec は 0 以上の整数、session.undelivered は number。これに反する入力に対する出力は未定義で、差分検査・ゴールデンの対象外。

---

## 1. データ型

### 1-1. チャット（chat）

| 項目 | 型 | 意味 |
|---|---|---|
| id | number | 一意番号（受信のたびに 1 ずつ増える。受信順を表す） |
| sender | string | 送信者名 |
| text | string | 本文 |
| correctPrio | "high" / "mid" / "low" | 正解の優先度 |
| options | string[] | Level 1 の選択肢（Level 2/3 は空配列） |
| correctOpt | number / null | Level 1 の正解選択肢の番号。返信不要の問題は null |
| reply | string | Level 2/3 のお手本（Level 1 は ""） |
| requiresReply | boolean | 返信が必要か |
| status | "unread" / "unreplied" / "completed" | 未処理 / 保留（優先度選択済み） / 処理済。**優先度の選び直し**で unreplied → unread に戻る。このとき selectedPrio は null に戻すが、prioAt（最初に優先度を選んだ時刻）と draft は保持する。したがって status=unread かつ prioAt≠null かつ selectedPrio=null の状態は正規に存在する |
| selectedPrio | "high" / "mid" / "low" / null | 利用者が選んだ優先度 |
| selectedAction | "reply" / "no_reply" / "" | 完了時の操作。未完了は "" |
| selectedReply | string | 送信した返信文（Level 1 は選んだ選択肢の文、no_reply は ""） |
| draft | string | 入力欄の下書き |
| createdAt, openedAt, prioAt, completedAt | number / null | ミリ秒時刻。未記録は null（createdAt は常にある） |
| isPrioCorrect, isReplyCorrect | boolean / null | 判定結果。未完了は null |

### 1-2. 完了操作（result）

| 項目 | 型 | 意味 |
|---|---|---|
| action | "reply" / "no_reply" | 返信して完了 / 返信せずに完了 |
| optionIndex | number | Level 1 で選んだ選択肢番号（reply のときのみ） |
| selectedReply | string | Level 2/3 で送信した下書き（reply のときのみ） |

### 1-3. セッション（session）

| 項目 | 型 | 意味 |
|---|---|---|
| level | 1 / 2 / 3 | レベル |
| durationSec | 300 / 600 / 900 | 制限時間（秒）。Level 1 では使わない |
| chats | chat[] | 受信トレイの全チャット |
| phoneRecords | { caller, isEmergency, didAnswer, correct }[] | 電話判断の記録（Level 3 のみ。correct は §4-2 judgePhone で決める） |
| endReason | "time" / "complete" / "manual" | 終了理由 |
| undelivered | number | 途中終了時にまだ届いていなかったチャット数。Level 1 では常に 0 |

---

## 2. ラベル表

| キー | 表示 |
|---|---|
| high | 高 |
| mid | 中 |
| low | 低 |
| unread | 未処理 |
| unreplied | 保留 |
| completed | 処理済 |

| endReason | 表示 |
|---|---|
| time | 時間終了 |
| complete | 全件完了 |
| その他（manual を含む） | 手動終了 |

---

## 3. 入力の正規化と一致（Level 2/3）

### 3-1. normalize(value)

1. value が null / undefined / 空なら ""。それ以外は文字列化する。
2. すべての空白文字（`\s`。半角スペース・全角スペース・改行・タブを含む）を取り除く。
3. 全角カンマ「，」(U+FF0C) を「、」に、全角ピリオド「．」(U+FF0E) を「。」に置き換える。
4. それ以外の文字は変えない（英数字の全角/半角、大文字/小文字、「！」と「!」などは区別する）。

### 3-2. commonPrefixLength(a, b)

a と b の先頭から同じ文字が続く長さ（UTF-16 コード単位で比較）。

### 3-3. typingProgress(draft, reply) → { percent, done, feedback, matched, extra }

- d = normalize(draft)、t = normalize(reply)、matched = commonPrefixLength(d, t)、extra = max(0, d.length − t.length)
- done = (d === t かつ t.length > 0)
- percent = t.length が 0 なら 0。そうでなければ min(100, round(matched / t.length × 100))。ただし **done でないのに 100 になるときは 99** にする。
- feedback（案内文）は上から順に最初に当てはまるもの:

| 条件 | feedback |
|---|---|
| done | `入力が一致しました。送信できます。` |
| matched === t.length かつ extra > 0（お手本を打ち切ったうえで余分な文字がある） | `文字が多すぎます。末尾の {extra} 文字を消してください（一致 {matched}/{t.length} 文字）` |
| d.length > matched（途中に誤りがある） | `一致 {matched}/{t.length} 文字。赤い文字の位置から直してください` |
| それ以外（途中まで正しく打っている） | `一致 {matched}/{t.length} 文字` |

### 3-4. targetMarks(draft, reply) → { marks, extra }

お手本の色付け。d, t, matched は 3-3 と同じ。reply の **元の文字列**（正規化前）を1文字ずつ（サロゲートペアは1文字）走査し、次の state を付ける。空白文字は数えない。

| 位置（空白を除いた通し番号 index） | state |
|---|---|
| 空白文字 | space |
| index < matched | typed（緑） |
| matched ≤ index < d.length | wrong（赤） |
| それ以外 | plain（未入力） |

- extra = d.length > t.length なら d の t.length 文字目以降（余分に打った文字列）。それ以外は ""。
- marks の要素は `{ char, state }`。

---

## 4. 完了時の判定 judge(chat, result, level) → { isPrioCorrect, isReplyCorrect }

- isPrioCorrect = (chat.correctPrio === chat.selectedPrio)
- isReplyCorrect は次の表（一因一罰: 優先度の誤りは返信の判定に影響しない）:

| result.action | level | isReplyCorrect |
|---|---|---|
| no_reply | 全て | chat.requiresReply === false |
| reply | 1 | chat.requiresReply === true かつ result.optionIndex === chat.correctOpt |
| reply | 2, 3 | chat.requiresReply === true かつ normalize(result.selectedReply) === normalize(chat.reply) |

### 4-2. 電話 judgePhone(isEmergency, didAnswer) → { correct }

- correct = (isEmergency === didAnswer)。緊急の相手に応答した／緊急でない相手を無視した、が正解。

---

## 5. 数値の補助

| 関数 | 定義 |
|---|---|
| percent(n, d) | d が 0（または偽）なら **null**。そうでなければ round(n / d × 100) |
| average(values) | 値のうち ""・null・undefined を除き、Number にして有限のものだけを使う。1つも無ければ **null**。あれば平均を toFixed(1) した **文字列** |
| formatStat(v) | v が null / undefined なら "-"、それ以外は String(v) |
| secondsBetween(start, end) | start または end が偽（null/0）なら ""。それ以外は ((end − start) / 1000).toFixed(1) の文字列 |
| formatTime(sec) | 分:秒 を各2桁ゼロ埋め（例 600 → "10:00"、59 → "00:59"）。sec は 0 以上の整数（呼び出し側が 0 で下限を切る） |

---

## 6. 結果画面の見出し

- levelSubtitle(level, durationSec):

| level | 文字列 |
|---|---|
| 1 | `選択式・全件完了で終了` |
| 2 | `{round(durationSec/60)}分・タイピング式` |
| 3 | `{round(durationSec/60)}分・タイピング式・電話割り込み` |

- endReasonText(reason): 2 のラベル表。
- resultSubtitle(level, durationSec, reason, undelivered) = `{levelSubtitle} / {endReasonText}` に、undelivered > 0 なら `（未着 {undelivered} 件）` を **直後に** 付ける（全角括弧、"未着" と数値の間に半角スペース、数値と "件" の間に半角スペース）。

---

## 7. 集計 summarize(session) → { total, completed, undelivered, prioAccuracy, replyAccuracy, averageTotal, phoneAccuracy, strengths, nextSteps, reviewRows }

定数: GOOD = 80、PRAISE_MIN_COMPLETED = 3、PRAISE_MIN_PHONES = 2。

### 7-1. 数値

| 項目 | 定義 |
|---|---|
| completedList | status === "completed" のチャット |
| total | chats の件数 |
| completed | completedList の件数 |
| undelivered | level 1 なら 0。それ以外は max(0, session.undelivered) |
| prioAccuracy | percent(completedList のうち isPrioCorrect が真の件数, completed) |
| replyAccuracy | percent(completedList のうち isReplyCorrect が真の件数, completed) |
| averageTotal | average(completedList の各 secondsBetween(openedAt, completedAt)) |
| noReplyAccuracy（内部） | completedList のうち requiresReply が偽のものを分母に、そのうち isReplyCorrect が真の件数を分子にした percent |
| requiredReplyAccuracy（内部） | completedList のうち requiresReply が真のものを分母に、そのうち isReplyCorrect が真の件数を分子にした percent |
| phoneAccuracy | percent(phoneRecords のうち correct が真の件数, phoneRecords の件数)（phoneRecords が無ければ空配列として扱う） |
| reviewRows | chats のうち、未完了のもの、または完了していて isPrioCorrect か isReplyCorrect のどちらかが偽のもの（元の順序のまま） |

内部フラグ（completedList について）:

- repliedToNoReply = requiresReply が偽で selectedAction === "reply" のものが1件でもある
- skippedRequired = requiresReply が真で selectedAction === "no_reply" のものが1件でもある
- wrongReplyText = requiresReply が真で selectedAction === "reply" で isReplyCorrect が偽のものが1件でもある
- enough = completed ≥ PRAISE_MIN_COMPLETED

### 7-2. よかった点 strengths（この順で条件を満たすものを追加）

| 条件 | 文 |
|---|---|
| completed > 0 | `{completed}件を最後まで処理しました。` |
| enough かつ prioAccuracy が null でなく ≥ GOOD | `優先度の判断が安定しています。` |
| enough かつ replyAccuracy が null でなく ≥ GOOD かつ **not**（noReplyAccuracy が null でなく < GOOD）かつ **not**（requiredReplyAccuracy が null でなく < GOOD） | `返信する、返信しないの切り分けが安定しています。` |
| level === 3 かつ phoneRecords の件数 ≥ PRAISE_MIN_PHONES かつ phoneAccuracy が null でなく ≥ GOOD | `電話割り込みの緊急度判断が安定しています。` |
| 上のどれも追加されなかった | `開始して結果を残せています。次回は1件ずつ確実に進めましょう。` |

### 7-3. 次の練習 nextSteps（この順で条件を満たすものを追加）

| 条件 | 文 |
|---|---|
| undelivered > 0 | `途中で終了したため、{undelivered}件のチャットが届く前に終わりました。次は最後まで続けてみましょう。` |
| 未完了（status が "completed" でない）チャットが1件でもある | `未完了タスクを減らすため、未処理を開く順番を意識しましょう。` |
| prioAccuracy が null でなく < GOOD | `高は緊急度と影響範囲、中は期限、低は情報共有や雑談を目印にしましょう。` |
| replyAccuracy が null でなく < GOOD のとき、内訳ごとに（この順）: repliedToNoReply → / skippedRequired → / wrongReplyText → | `本文に「返信不要」があるか、送信前に一度確認しましょう。返信不要の連絡は入力せずに完了します。` / `依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。` / `相手の依頼に沿った返信文を選びましょう。` |
| （replyAccuracy が null か ≥ GOOD で）noReplyAccuracy が null でなく < GOOD | `返信不要タスクは入力せずに完了する練習を増やしましょう。` |
| （replyAccuracy が null か ≥ GOOD で）requiredReplyAccuracy が null でなく < GOOD | `依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。` |
| level === 3 かつ phoneAccuracy が null でなく < GOOD | `電話は相手と内容の緊急性を見て、応答と無視を切り替えましょう。` |
| 上のどれも追加されなかった | `次は同じ条件で速度を少し上げるか、上位レベルに進みましょう。` |

---

## 8. 処理済チャットの訂正文 completedPanelText(chat, level) → { prioText, replyText }

| 条件 | prioText |
|---|---|
| isPrioCorrect が真 | `優先度は正解です。` |
| それ以外 | `優先度は {labels[correctPrio]} が正解です。` |

| 条件（上から最初に当てはまるもの） | replyText |
|---|---|
| isReplyCorrect が真 | `返信処理は正解です。` |
| requiresReply が偽 | `返信せずに完了するのが正解です。` |
| level === 1 かつ correctOpt が null でない | `正しい返信は「{options[correctOpt]}」です。` |
| それ以外 | `正しい返信は「{reply}」です。` |

---

## 9. 要確認タスク表の列

- priorityResultText(chat):
  - 未完了: `正解: {labels[correctPrio]}`
  - 完了: `{正解|不正解} / 正解: {labels[correctPrio]} / 選択: {labels[selectedPrio]}`（isPrioCorrect が真なら「正解」）
- replyResultText(chat):
  - 未完了: requiresReply が真なら `返信必要`、偽なら `返信不要`
  - 完了: `{正解|不正解} / {返信必要|返信不要}`（isReplyCorrect が真なら「正解」）

---

## 10. CSV

### 10-1. csvHeader()

`レベル, 状態, 送信者, メッセージ内容, 正解優先度, 選択優先度, 優先度正誤, 返信必要, 選択処理, 返信正誤, 確認時間(秒), 振り分け時間(秒), 返信時間(秒), 総処理時間(秒), 制限時間(分), 終了理由, 未着件数`（17 列。この順）

### 10-2. csvRow(chat, session) → string[17]

| 列 | 値 |
|---|---|
| レベル | `Level {level}` |
| 状態 | labels[status] |
| 送信者 | sender |
| メッセージ内容 | text |
| 正解優先度 | labels[correctPrio] |
| 選択優先度 | selectedPrio があれば labels[selectedPrio]、無ければ "" |
| 優先度正誤 | isPrioCorrect が null なら ""、真なら "正解"、偽なら "不正解" |
| 返信必要 | requiresReply が真なら "必要"、偽なら "不要" |
| 選択処理 | selectedAction が "reply" なら "返信"、"no_reply" なら "返信せず完了"、それ以外 "" |
| 返信正誤 | isReplyCorrect が null なら ""、真なら "正解"、偽なら "不正解" |
| 確認時間(秒) | openedAt があれば secondsBetween(createdAt, openedAt)、無ければ "" |
| 振り分け時間(秒) | prioAt **かつ** selectedPrio があれば secondsBetween(openedAt, prioAt)、無ければ "" |
| 返信時間(秒) | completedAt があれば secondsBetween(prioAt, completedAt)、無ければ "" |
| 総処理時間(秒) | completedAt があれば secondsBetween(openedAt, completedAt)、無ければ "" |
| 制限時間(分) | level 1 なら ""。それ以外は String(round(durationSec / 60)) |
| 終了理由 | endReasonText(session.endReason) |
| 未着件数 | level 1 なら "0"。それ以外は String(max(0, session.undelivered)) |

（「あれば」は JavaScript の真偽判定。0 や null は「無い」扱い。振り分け時間で selectedPrio も見るのは、選び直して未処理に戻したチャットの古い prioAt を振り分け時間として出さないため。）

### 10-3. csvRows(chats, session) → string[17][]

chats を **id 昇順** に並べ（受信順。id は受信のたびに 1 ずつ増える番号で、createdAt は一時停止の補正で後からずれることがあるため並べ替えには使わない）、各要素に csvRow(chat, session) を適用した配列。

---

## 11. 問題データの原則（正解表の導出規則）

各問題の正解（correctPrio / requiresReply）は、本文から読み取れる **属性** から次の表で一意に決まらなければならない。
属性は `dev-tests/ref/answer-table.js` に問題ごとに列挙し、`e2e07_data.js` が導出結果と本体の正解表を突き合わせる。

### 11-1. 優先度（上から最初に当てはまる行）

| 属性 | correctPrio |
|---|---|
| urgent（システム停止・重大なクレーム・本日中の締切・重要顧客の来訪・至急の依頼のいずれか） | high |
| dated（数日内の提出・期限付きの依頼・通常の業務連絡・会議や予定の変更・期限のリマインド・対応事項のある全社連絡） | mid |
| それ以外（雑談・社内ニュース・任意参加の案内・情報共有・「急ぎではない」と書かれた軽い依頼） | low |

### 11-2. 返信要否（上から最初に当てはまる行）

| 属性 | requiresReply |
|---|---|
| noReplyMark（本文に「返信不要」の表記がある） | false |
| personal（同僚など個人からの声かけ） | true |
| request（依頼・質問・確認事項がある） | true |
| それ以外（お知らせ・情報共有だけ） | false |

### 11-3. 属性の根拠語（属性表の各行は、本文中の根拠を示さなければならない）

| 属性 | 根拠の示し方 | 検査 |
|---|---|---|
| urgent / dated | 本文中の語句を `cue` として引用する（例「重要顧客」「今週末までに」「会議」） | cue が本文に含まれること |
| request | 次の類型語のいずれかが本文にあること: `ください` `お願いします` `でしょうか` `ですか` `ますか` `ご返信` `てくれ` `来れそう` `必要です` `いかがいたしましょうか` | 類型語が本文にあること。request が偽の問題には類型語が無いこと |
| personal | 送信者が個人（送信者名に「同僚」「営業の」など個人を表す語） | 送信者名に個人の語があること。personal が偽の送信者には無いこと |
| noReplyMark | 本文に「返信不要」 | 本文と一致すること |

### 11-4. 判定基準パネルの文言（利用者が読む規則。仕様の属性と 1 対 1 に対応させる）

| 属性 | パネルに必ず含める語句 |
|---|---|
| urgent | `システム停止` `重大なクレーム` `本日中の締切` `重要顧客の来訪` `至急の依頼` |
| dated | `数日内の提出` `期限付きの依頼` `通常の業務連絡` `会議・予定の変更` `リマインド` `対応事項のある全社連絡` |
| それ以外（低） | `雑談` `社内ニュース` `任意参加の案内` `情報共有` `「急ぎではない」と書かれた軽い依頼` |
| 返信 | `「返信不要」は送らず完了` `個人からの声かけでも` `依頼・質問・確認事項がある連絡には返信` `内容が情報共有でも返信` |
| 電話 | `営業の電話や誘いの電話は無視` |

### 11-5. データの不変条件

- お手本（reply）と選択肢は BMP 内の文字だけで、空白文字を含まない（サロゲートペア・結合文字を含める場合は §3 の文字数の数え方を見直す）。
- 返信必要（requiresReply=true）の Level 1 問題は correctOpt を持つ。返信不要の問題は correctOpt が null。
- 同じ本文に異なる正解を付けない。送信者名はレベル内で一意。

### 11-6. 電話

| 属性 | 正しい操作 |
|---|---|
| isEmergency（重要顧客・障害監視・社長） | 応答する（didAnswer = true） |
| それ以外（営業・誘い） | 無視する（didAnswer = false） |

---

## 12. 操作の門番（UI 側の原則。Logic ではなく本体の UI コードに実装）

判定に直接関わらないが、誤操作が判定に化けるのを防ぐ規則。原則は1つ: **画面が切り替わった直後は、切り替わる前の画面に向けた操作を受け付けない。**

| # | 規則 | 値 |
|---|---|---|
| 1 | 画面が切り替わった（優先度→返信パネル、着信・停止画面の開閉）直後のマウス操作は無視 | 400 ms |
| 2 | 優先度ボタンをマウスで押した直後、同じ位置へのクリックは無視（ゆっくりなダブルクリック） | 700 ms / 24 px |
| 3 | 着信画面の表示直後はキー操作も無視（入力中の Space/Enter の続き） | 500 ms |
| 4 | キーの長押し（自動リピート）の Enter / Space / Esc は操作として扱わない | ─ |
| 5 | それ以外のキーボード操作は常に受け付ける | ─ |

これらは `e2e10_audit.js` で利用者操作として検査する（差分検査の対象外）。
