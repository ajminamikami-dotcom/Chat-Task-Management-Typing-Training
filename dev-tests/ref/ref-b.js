'use strict';
/*
 * ref-b.js — 参照実装 B
 *
 * 仕様書 dev-tests/spec/judgment-spec.md の規則「だけ」から、
 * 判定・集計・表示文・CSV・入力一致のロジックを素直な手続き（if/else）で実装したもの。
 * アプリ本体や他の検査コードは一切参照していない。
 * 各関数の先頭に、対応する仕様書の節番号をコメントで示す。
 *
 * 依存パッケージなし（標準 JS のみ / CommonJS）。
 */

// ---------------------------------------------------------------------------
// §2 ラベル表
// ---------------------------------------------------------------------------
const labels = {
  high: '高',
  mid: '中',
  low: '低',
  unread: '未処理',
  unreplied: '保留',
  completed: '処理済',
};

// §7 定数
const GOOD = 80;
const PRAISE_MIN_COMPLETED = 3;
const PRAISE_MIN_PHONES = 2;

// ---------------------------------------------------------------------------
// §3-1 normalize(value)
// ---------------------------------------------------------------------------
function normalize(value) {
  // 1. null / undefined / 空なら ""。それ以外は文字列化
  if (value === null || value === undefined || value === '') {
    return '';
  }
  let s = String(value);
  // 2. すべての空白文字（\s）を取り除く
  s = s.replace(/\s/g, '');
  // 3. 全角カンマ → 「、」、全角ピリオド → 「。」
  s = s.replace(/，/g, '、');
  s = s.replace(/．/g, '。');
  // 4. それ以外は変えない
  return s;
}

// ---------------------------------------------------------------------------
// §3-2 commonPrefixLength(a, b)  UTF-16 コード単位で比較
// ---------------------------------------------------------------------------
function commonPrefixLength(a, b) {
  const sa = a === null || a === undefined ? '' : String(a);
  const sb = b === null || b === undefined ? '' : String(b);
  const limit = Math.min(sa.length, sb.length);
  let n = 0;
  while (n < limit && sa.charCodeAt(n) === sb.charCodeAt(n)) {
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// §3-3 typingProgress(draft, reply) → { percent, done, feedback, matched, extra }
// ---------------------------------------------------------------------------
function typingProgress(draft, reply) {
  const d = normalize(draft);
  const t = normalize(reply);
  const matched = commonPrefixLength(d, t);
  const extra = Math.max(0, d.length - t.length);
  const done = d === t && t.length > 0;

  let percent;
  if (t.length === 0) {
    percent = 0;
  } else {
    percent = Math.min(100, Math.round((matched / t.length) * 100));
    // done でないのに 100 になるときは 99
    if (!done && percent === 100) {
      percent = 99;
    }
  }

  let feedback;
  if (done) {
    feedback = '入力が一致しました。送信できます。';
  } else if (matched === t.length && extra > 0) {
    feedback =
      '文字が多すぎます。末尾の ' + extra + ' 文字を消してください（一致 ' +
      matched + '/' + t.length + ' 文字）';
  } else if (d.length > matched) {
    feedback = '一致 ' + matched + '/' + t.length + ' 文字。赤い文字の位置から直してください';
  } else {
    feedback = '一致 ' + matched + '/' + t.length + ' 文字';
  }

  return { percent: percent, done: done, feedback: feedback, matched: matched, extra: extra };
}

// ---------------------------------------------------------------------------
// §3-4 targetMarks(draft, reply) → { marks, extra }
// ---------------------------------------------------------------------------
function targetMarks(draft, reply) {
  const d = normalize(draft);
  const t = normalize(reply);
  const matched = commonPrefixLength(d, t);

  // reply の元の文字列を 1 文字ずつ（サロゲートペアは 1 文字）走査
  const original = reply === null || reply === undefined ? '' : String(reply);
  const chars = Array.from(original);
  const marks = [];
  let index = 0; // 空白を除いた通し番号
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    let state;
    if (/\s/.test(ch)) {
      state = 'space';
    } else {
      if (index < matched) {
        state = 'typed';
      } else if (index < d.length) {
        state = 'wrong';
      } else {
        state = 'plain';
      }
      index++;
    }
    marks.push({ char: ch, state: state });
  }

  const extra = d.length > t.length ? d.slice(t.length) : '';
  return { marks: marks, extra: extra };
}

// ---------------------------------------------------------------------------
// §4 judge(chat, result, level) → { isPrioCorrect, isReplyCorrect }
// ---------------------------------------------------------------------------
function judge(chat, result, level) {
  const isPrioCorrect = chat.correctPrio === chat.selectedPrio;

  let isReplyCorrect;
  if (result.action === 'no_reply') {
    isReplyCorrect = chat.requiresReply === false;
  } else if (Number(level) === 1) {
    isReplyCorrect = chat.requiresReply === true && result.optionIndex === chat.correctOpt;
  } else {
    isReplyCorrect =
      chat.requiresReply === true && normalize(result.selectedReply) === normalize(chat.reply);
  }

  return { isPrioCorrect: isPrioCorrect, isReplyCorrect: isReplyCorrect };
}

// ---------------------------------------------------------------------------
// §4-2 電話 judgePhone(isEmergency, didAnswer) → { correct }
// ---------------------------------------------------------------------------
function judgePhone(isEmergency, didAnswer) {
  // 緊急の相手に応答した／緊急でない相手を無視した、が正解
  const correct = isEmergency === didAnswer;
  return { correct: correct };
}

// ---------------------------------------------------------------------------
// §5 数値の補助
// ---------------------------------------------------------------------------
function percent(n, d) {
  if (!d) {
    return null;
  }
  return Math.round((n / d) * 100);
}

function average(values) {
  const nums = [];
  const list = Array.isArray(values) ? values : [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === '' || v === null || v === undefined) {
      continue;
    }
    const num = Number(v);
    if (Number.isFinite(num)) {
      nums.push(num);
    }
  }
  if (nums.length === 0) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < nums.length; i++) {
    sum += nums[i];
  }
  return (sum / nums.length).toFixed(1);
}

function formatStat(v) {
  if (v === null || v === undefined) {
    return '-';
  }
  return String(v);
}

function secondsBetween(start, end) {
  if (!start || !end) {
    return '';
  }
  return ((end - start) / 1000).toFixed(1);
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatTime(sec) {
  const total = Math.floor(Number(sec) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return pad2(m) + ':' + pad2(s);
}

// ---------------------------------------------------------------------------
// §6 結果画面の見出し
// ---------------------------------------------------------------------------
function levelSubtitle(level, durationSec) {
  const lv = Number(level);
  if (lv === 1) {
    return '選択式・全件完了で終了';
  }
  const minutes = Math.round(durationSec / 60);
  if (lv === 2) {
    return minutes + '分・タイピング式';
  }
  if (lv === 3) {
    return minutes + '分・タイピング式・電話割り込み';
  }
  return '';
}

function endReasonText(reason) {
  if (reason === 'time') {
    return '時間終了';
  }
  if (reason === 'complete') {
    return '全件完了';
  }
  return '手動終了';
}

function resultSubtitle(level, durationSec, reason, undelivered) {
  let text = levelSubtitle(level, durationSec) + ' / ' + endReasonText(reason);
  if (undelivered > 0) {
    text += '（未着 ' + undelivered + ' 件）';
  }
  return text;
}

// ---------------------------------------------------------------------------
// §7 集計 summarize(session)
// ---------------------------------------------------------------------------
function summarize(session) {
  const level = Number(session.level);
  const chats = Array.isArray(session.chats) ? session.chats : [];
  const phoneRecords = Array.isArray(session.phoneRecords) ? session.phoneRecords : [];

  // §7-1 数値
  const completedList = [];
  for (let i = 0; i < chats.length; i++) {
    if (chats[i].status === 'completed') {
      completedList.push(chats[i]);
    }
  }
  const total = chats.length;
  const completed = completedList.length;

  let undelivered;
  if (level === 1) {
    undelivered = 0;
  } else {
    undelivered = Math.max(0, Number(session.undelivered) || 0);
  }

  let prioCorrectCount = 0;
  let replyCorrectCount = 0;
  let noReplyCount = 0;
  let noReplyCorrectCount = 0;
  let requiredReplyCount = 0;
  let requiredReplyCorrectCount = 0;
  const totalSeconds = [];
  let repliedToNoReply = false;
  let skippedRequired = false;
  let wrongReplyText = false;
  for (let i = 0; i < completedList.length; i++) {
    const c = completedList[i];
    if (c.isPrioCorrect) {
      prioCorrectCount++;
    }
    if (c.isReplyCorrect) {
      replyCorrectCount++;
    }
    if (!c.requiresReply) {
      noReplyCount++;
      if (c.isReplyCorrect) {
        noReplyCorrectCount++;
      }
    } else {
      requiredReplyCount++;
      if (c.isReplyCorrect) {
        requiredReplyCorrectCount++;
      }
    }
    totalSeconds.push(secondsBetween(c.openedAt, c.completedAt));

    // 内部フラグ
    if (!c.requiresReply && c.selectedAction === 'reply') {
      repliedToNoReply = true;
    }
    if (c.requiresReply && c.selectedAction === 'no_reply') {
      skippedRequired = true;
    }
    if (c.requiresReply && c.selectedAction === 'reply' && !c.isReplyCorrect) {
      wrongReplyText = true;
    }
  }

  const prioAccuracy = percent(prioCorrectCount, completed);
  const replyAccuracy = percent(replyCorrectCount, completed);
  const averageTotal = average(totalSeconds);
  const noReplyAccuracy = percent(noReplyCorrectCount, noReplyCount);
  const requiredReplyAccuracy = percent(requiredReplyCorrectCount, requiredReplyCount);

  let phoneCorrectCount = 0;
  for (let i = 0; i < phoneRecords.length; i++) {
    if (phoneRecords[i].correct) {
      phoneCorrectCount++;
    }
  }
  const phoneAccuracy = percent(phoneCorrectCount, phoneRecords.length);

  const reviewRows = [];
  let hasIncomplete = false;
  for (let i = 0; i < chats.length; i++) {
    const c = chats[i];
    if (c.status !== 'completed') {
      hasIncomplete = true;
      reviewRows.push(c);
    } else if (!c.isPrioCorrect || !c.isReplyCorrect) {
      reviewRows.push(c);
    }
  }

  const enough = completed >= PRAISE_MIN_COMPLETED;

  // §7-2 よかった点
  const strengths = [];
  if (completed > 0) {
    strengths.push(completed + '件を最後まで処理しました。');
  }
  if (enough && prioAccuracy !== null && prioAccuracy >= GOOD) {
    strengths.push('優先度の判断が安定しています。');
  }
  if (
    enough &&
    replyAccuracy !== null &&
    replyAccuracy >= GOOD &&
    !(noReplyAccuracy !== null && noReplyAccuracy < GOOD) &&
    !(requiredReplyAccuracy !== null && requiredReplyAccuracy < GOOD)
  ) {
    strengths.push('返信する、返信しないの切り分けが安定しています。');
  }
  if (
    level === 3 &&
    phoneRecords.length >= PRAISE_MIN_PHONES &&
    phoneAccuracy !== null &&
    phoneAccuracy >= GOOD
  ) {
    strengths.push('電話割り込みの緊急度判断が安定しています。');
  }
  if (strengths.length === 0) {
    strengths.push('開始して結果を残せています。次回は1件ずつ確実に進めましょう。');
  }

  // §7-3 次の練習
  const nextSteps = [];
  if (undelivered > 0) {
    nextSteps.push(
      '途中で終了したため、' + undelivered +
        '件のチャットが届く前に終わりました。次は最後まで続けてみましょう。'
    );
  }
  if (hasIncomplete) {
    nextSteps.push('未完了タスクを減らすため、未処理を開く順番を意識しましょう。');
  }
  if (prioAccuracy !== null && prioAccuracy < GOOD) {
    nextSteps.push('高は緊急度と影響範囲、中は期限、低は情報共有や雑談を目印にしましょう。');
  }
  if (replyAccuracy !== null && replyAccuracy < GOOD) {
    if (repliedToNoReply) {
      nextSteps.push(
        '本文に「返信不要」があるか、送信前に一度確認しましょう。返信不要の連絡は入力せずに完了します。'
      );
    }
    if (skippedRequired) {
      nextSteps.push('依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。');
    }
    if (wrongReplyText) {
      nextSteps.push('相手の依頼に沿った返信文を選びましょう。');
    }
  } else {
    // replyAccuracy が null か ≥ GOOD のとき、内訳ごとに助言
    if (noReplyAccuracy !== null && noReplyAccuracy < GOOD) {
      nextSteps.push('返信不要タスクは入力せずに完了する練習を増やしましょう。');
    }
    if (requiredReplyAccuracy !== null && requiredReplyAccuracy < GOOD) {
      nextSteps.push('依頼・質問・確認事項がある連絡や、同僚からの声かけには返信しましょう。');
    }
  }
  if (level === 3 && phoneAccuracy !== null && phoneAccuracy < GOOD) {
    nextSteps.push('電話は相手と内容の緊急性を見て、応答と無視を切り替えましょう。');
  }
  if (nextSteps.length === 0) {
    nextSteps.push('次は同じ条件で速度を少し上げるか、上位レベルに進みましょう。');
  }

  return {
    total: total,
    completed: completed,
    undelivered: undelivered,
    prioAccuracy: prioAccuracy,
    replyAccuracy: replyAccuracy,
    averageTotal: averageTotal,
    phoneAccuracy: phoneAccuracy,
    strengths: strengths,
    nextSteps: nextSteps,
    reviewRows: reviewRows,
  };
}

// ---------------------------------------------------------------------------
// §8 処理済チャットの訂正文 completedPanelText(chat, level) → { prioText, replyText }
// ---------------------------------------------------------------------------
function completedPanelText(chat, level) {
  let prioText;
  if (chat.isPrioCorrect) {
    prioText = '優先度は正解です。';
  } else {
    prioText = '優先度は ' + labels[chat.correctPrio] + ' が正解です。';
  }

  let replyText;
  if (chat.isReplyCorrect) {
    replyText = '返信処理は正解です。';
  } else if (!chat.requiresReply) {
    replyText = '返信せずに完了するのが正解です。';
  } else if (Number(level) === 1 && chat.correctOpt !== null && chat.correctOpt !== undefined) {
    replyText = '正しい返信は「' + chat.options[chat.correctOpt] + '」です。';
  } else {
    replyText = '正しい返信は「' + chat.reply + '」です。';
  }

  return { prioText: prioText, replyText: replyText };
}

// ---------------------------------------------------------------------------
// §9 要確認タスク表の列
// ---------------------------------------------------------------------------
function priorityResultText(chat) {
  if (chat.status !== 'completed') {
    return '正解: ' + labels[chat.correctPrio];
  }
  const verdict = chat.isPrioCorrect ? '正解' : '不正解';
  return verdict + ' / 正解: ' + labels[chat.correctPrio] + ' / 選択: ' + labels[chat.selectedPrio];
}

function replyResultText(chat) {
  const need = chat.requiresReply ? '返信必要' : '返信不要';
  if (chat.status !== 'completed') {
    return need;
  }
  const verdict = chat.isReplyCorrect ? '正解' : '不正解';
  return verdict + ' / ' + need;
}

// ---------------------------------------------------------------------------
// §10-1 csvHeader()
// ---------------------------------------------------------------------------
function csvHeader() {
  return [
    'レベル',
    '状態',
    '送信者',
    'メッセージ内容',
    '正解優先度',
    '選択優先度',
    '優先度正誤',
    '返信必要',
    '選択処理',
    '返信正誤',
    '確認時間(秒)',
    '振り分け時間(秒)',
    '返信時間(秒)',
    '総処理時間(秒)',
    '制限時間(分)',
    '終了理由',
    '未着件数',
  ];
}

// ---------------------------------------------------------------------------
// §10-2 csvRow(chat, session) → string[17]
// ---------------------------------------------------------------------------
function correctnessText(v) {
  if (v === null || v === undefined) {
    return '';
  }
  return v ? '正解' : '不正解';
}

function csvRow(chat, session) {
  const level = Number(session.level);

  let selectedPrioText = '';
  if (chat.selectedPrio) {
    selectedPrioText = labels[chat.selectedPrio];
  }

  let actionText;
  if (chat.selectedAction === 'reply') {
    actionText = '返信';
  } else if (chat.selectedAction === 'no_reply') {
    actionText = '返信せず完了';
  } else {
    actionText = '';
  }

  const openTime = chat.openedAt ? secondsBetween(chat.createdAt, chat.openedAt) : '';
  const prioTime =
    chat.prioAt && chat.selectedPrio ? secondsBetween(chat.openedAt, chat.prioAt) : '';
  const replyTime = chat.completedAt ? secondsBetween(chat.prioAt, chat.completedAt) : '';
  const totalTime = chat.completedAt ? secondsBetween(chat.openedAt, chat.completedAt) : '';

  let limitText;
  if (level === 1) {
    limitText = '';
  } else {
    limitText = String(Math.round(session.durationSec / 60));
  }

  let undeliveredText;
  if (level === 1) {
    undeliveredText = '0';
  } else {
    undeliveredText = String(Math.max(0, Number(session.undelivered) || 0));
  }

  return [
    'Level ' + session.level,
    labels[chat.status],
    chat.sender,
    chat.text,
    labels[chat.correctPrio],
    selectedPrioText,
    correctnessText(chat.isPrioCorrect),
    chat.requiresReply ? '必要' : '不要',
    actionText,
    correctnessText(chat.isReplyCorrect),
    openTime,
    prioTime,
    replyTime,
    totalTime,
    limitText,
    endReasonText(session.endReason),
    undeliveredText,
  ];
}

// ---------------------------------------------------------------------------
// §10-3 csvRows(chats, session) → string[17][]
// ---------------------------------------------------------------------------
function csvRows(chats, session) {
  const list = Array.isArray(chats) ? chats.slice() : [];
  // createdAt 昇順、同値なら id 昇順（受信順）
  list.sort(function (a, b) {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    rows.push(csvRow(list[i], session));
  }
  return rows;
}

module.exports = {
  labels,
  normalize,
  commonPrefixLength,
  typingProgress,
  targetMarks,
  judge,
  judgePhone,
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
  csvRows,
};
