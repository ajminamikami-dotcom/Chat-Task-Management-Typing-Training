// answer-table.js 問題データの原則（仕様書 §11）
//   各問題の本文から読み取れる「属性」を列挙し、正解（優先度・返信要否）を 1 つの規則表から導く。
//   本体の正解表（LEVEL1_DATA / TYPING_DATA / PHONE_DATA）はこの導出結果と一致しなければならない（e2e07 が突き合わせる）。
//   問題を足す・本文を変えるときは、まずここに属性を書き、導出結果が意図した正解になることを確かめる。
"use strict";

// 属性の意味（仕様書 §11）
//   urgent      : システム停止・重大なクレーム・本日中の締切・重要顧客の来訪・至急の依頼
//   dated       : 数日内の提出・期限付きの依頼・通常の業務連絡・会議や予定の変更・期限のリマインド・対応事項のある全社連絡
//   noReplyMark : 本文に「返信不要」の表記がある
//   personal    : 同僚など個人からの声かけ
//   request     : 依頼・質問・確認事項がある
const ATTRIBUTES = [
  // Level 1
  { level: 1, sender: "田中部長",    urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "重大なクレーム・至急の依頼" },
  { level: 1, sender: "システム通知", urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "サーバーダウン（システム停止）・復旧依頼" },
  { level: 1, sender: "営業推進部",   urgent: false, dated: false, noReplyMark: true,  personal: false, request: false, why: "配信のお知らせ（返信不要）" },
  { level: 1, sender: "総務部",       urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "今週末までに提出" },
  { level: 1, sender: "同僚の佐藤",   urgent: false, dated: false, noReplyMark: false, personal: true,  request: true,  why: "同僚からの声かけ（飲み会の誘い）" },
  { level: 1, sender: "経理部",       urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "修正して再提出（通常の業務連絡・依頼）" },
  { level: 1, sender: "社内広報",     urgent: false, dated: false, noReplyMark: false, personal: false, request: false, why: "社内ニュース（情報共有）" },
  { level: 1, sender: "営業の鈴木",   urgent: false, dated: false, noReplyMark: false, personal: true,  request: false, why: "同僚からの声かけ（お土産）" },
  { level: 1, sender: "A社 担当者",   urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "会議時間の変更の相談（予定の変更・質問）" },
  { level: 1, sender: "受付",         urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "重要顧客の来訪・確認事項" },
  { level: 1, sender: "全社通知",     urgent: false, dated: true,  noReplyMark: true,  personal: false, request: true,  why: "停電に伴う対応事項（PC の電源）のある全社連絡（返信不要）" },
  // Level 2/3
  { level: 2, sender: "顧客サポート", urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "重大なクレーム（確認事項）" },
  { level: 2, sender: "経理部",       urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "本日締切・15時までに処理" },
  { level: 2, sender: "サーバー監視", urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "障害アラート・至急対応の依頼" },
  { level: 2, sender: "営業推進部",   urgent: false, dated: false, noReplyMark: true,  personal: false, request: false, why: "配信のお知らせ（返信不要）" },
  { level: 2, sender: "B社 担当者",   urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "納品不足のクレーム・質問" },
  { level: 2, sender: "受付",         urgent: true,  dated: false, noReplyMark: false, personal: false, request: true,  why: "重要顧客の来訪（お怒り）・確認事項" },
  { level: 2, sender: "全社通知",     urgent: false, dated: false, noReplyMark: true,  personal: false, request: false, why: "標語のお知らせ（返信不要）" },
  { level: 2, sender: "総務部 施設担当", urgent: false, dated: true, noReplyMark: false, personal: false, request: true, why: "金曜までに提出" },
  { level: 2, sender: "人事部",       urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "期限のリマインド・受講の依頼" },
  { level: 2, sender: "IT部門",       urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "5日以内に変更" },
  { level: 2, sender: "営業事務",     urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "水曜が締め切り" },
  { level: 2, sender: "総務部 防災担当", urgent: false, dated: true, noReplyMark: false, personal: false, request: true, why: "今週中に参加可否を返信" },
  { level: 2, sender: "社内広報",     urgent: false, dated: false, noReplyMark: false, personal: false, request: false, why: "社内ニュース（情報共有）" },
  { level: 2, sender: "営業の吉田",   urgent: false, dated: false, noReplyMark: false, personal: true,  request: false, why: "同僚からの声かけ（メロン）" },
  { level: 2, sender: "システム通知", urgent: false, dated: false, noReplyMark: false, personal: false, request: true,  why: "「急ぎではない」と書かれた軽い依頼" },
  { level: 2, sender: "労働組合",     urgent: false, dated: false, noReplyMark: true,  personal: false, request: false, why: "設置のお知らせ（返信不要）" },
  { level: 2, sender: "食堂",         urgent: false, dated: false, noReplyMark: true,  personal: false, request: false, why: "メニューのお知らせ（返信不要）" },
  { level: 2, sender: "田中部長",     urgent: false, dated: true,  noReplyMark: true,  personal: false, request: false, why: "会議の予定変更（返信不要）" },
  { level: 2, sender: "品質管理",     urgent: false, dated: true,  noReplyMark: false, personal: false, request: true,  why: "今週中に確認" },
  { level: 2, sender: "広報チーム",   urgent: false, dated: false, noReplyMark: true,  personal: false, request: false, why: "任意参加の案内（返信不要）" },
];

const PHONE_ATTRIBUTES = [
  { caller: "重要顧客 A社 取締役", isEmergency: true },
  { caller: "システム障害監視センター", isEmergency: true },
  { caller: "社長", isEmergency: true },
  { caller: "不動産投資の営業", isEmergency: false },
  { caller: "別部署の同僚 飲み会の誘い", isEmergency: false },
  { caller: "オフィス用品のセールス", isEmergency: false },
];

// 仕様書 §11-1 / §11-2 の規則表（上から最初に当てはまる行）
function derivePriority(a) {
  if (a.urgent) return "high";
  if (a.dated) return "mid";
  return "low";
}

function deriveRequiresReply(a) {
  if (a.noReplyMark) return false;
  if (a.personal) return true;
  if (a.request) return true;
  return false;
}

function derivePhone(p) {
  return p.isEmergency ? "answer" : "ignore";
}

module.exports = { ATTRIBUTES, PHONE_ATTRIBUTES, derivePriority, deriveRequiresReply, derivePhone };
