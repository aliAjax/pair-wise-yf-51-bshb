import { browser } from "$app/environment";
import { derived, get, writable } from "svelte/store";

export type TrackStatus = "草稿" | "审校中" | "已通过" | "需修改";
export type CueStatus = "待译" | "翻译中" | "待审" | "已通过" | "退回";
export type TermStatus = "建议" | "已锁定";

/** 一次退回留下的意见；采纳其中一份后其余仍留档可查 */
export interface ReviewOpinion {
  id: string;
  reviewer: string;
  note: string;
  time: string;
  status: "已采纳" | "未采纳";
}

/** 术语译法变更时挂到字幕上的待处理变更 */
export interface PendingTermChange {
  termId: string;
  source: string;
  oldTarget: string;
  newTarget: string;
}

/** 审校通过时冻结的版本，后续退回重审也继续保留 */
export interface FrozenVersion {
  translated: string;
  start: number;
  end: number;
  time: string;
}

export interface Track {
  id: string;
  name: string;
  locale: "zh" | "en" | "ja";
  status: TrackStatus;
}

export interface Cue {
  id: string;
  trackId: string;
  start: number;
  end: number;
  source: string;
  translated: string;
  status: CueStatus;
  translator: string;
  /** 当前认领的审校员，null 表示在队列里 */
  heldBy: string | null;
  heldAt: string | null;
  /** 历次退回意见（可多份，长期保留） */
  opinions: ReviewOpinion[];
  /** 术语译法变更带来的待确认变更 */
  pendingTerms: PendingTermChange[];
  termDirty: boolean;
  /** 最近一次通过时冻结的版本 */
  frozen: FrozenVersion | null;
}

export interface GlossaryTerm {
  id: string;
  locale: "en" | "ja";
  source: string;
  target: string;
  prevTarget: string | null;
  status: TermStatus;
  owner: string;
  updatedAt: string | null;
}

export type ReviewAction =
  | "提交审校"
  | "审校通过"
  | "退回修改"
  | "术语锁定"
  | "术语译法变更"
  | "认领审校"
  | "放回队列"
  | "超时收回"
  | "重新确认"
  | "交付准备";

export interface ReviewEvent {
  id: string;
  cueId: string;
  action: ReviewAction;
  detail: string;
  actor: string;
  time: string;
}

export interface Snapshot {
  id: string;
  name: string;
  time: string;
  cues: Cue[];
}

export interface TimelineConflict {
  id: string;
  cueId: string;
  message: string;
  remoteStart: number;
  remoteEnd: number;
  status: "待处理" | "采用本地" | "采用协作版本";
}

export interface DeliveryItem {
  locale: string;
  trackName: string;
  status: "未尝试" | "已生成" | "失败" | "被挡住";
  attempts: number;
  content: string | null;
  cueCount: number;
  reason: string | null;
  error: string | null;
  time: string | null;
}

export interface Readiness {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  draft: number;
  held: number;
  stale: number;
  termReconfirm: number;
  blockers: string[];
}

/** 审校员一次最多带走的条数 */
export const MAX_HELD_PER_REVIEWER = 8;
/** 超过该时长未交回则放回队列 */
export const HOLD_TIMEOUT_MS = 10 * 60 * 1000;

export type NoticeKind = "info" | "success" | "warn" | "error";
export interface Notice {
  id: string;
  text: string;
  kind: NoticeKind;
}

const KEY = "pair-wise-yf-51/subtitles-v2";
const nowIso = () => new Date().toISOString();
const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const seedTracks: Track[] = [
  { id: "zh", name: "中文原字幕", locale: "zh", status: "已通过" },
  { id: "en", name: "English 翻译", locale: "en", status: "审校中" },
  { id: "ja", name: "日本語訳", locale: "ja", status: "草稿" }
];

const S1 = "潮汐退去后，码头重新露出水面。";
const S2 = "修复组必须在下一场潮水到来前完成加固。";

const seedCues: Cue[] = [
  { id: "c1", trackId: "zh", start: 0, end: 2.8, source: S1, translated: S1, status: "已通过", translator: "系统", heldBy: null, heldAt: null, opinions: [], pendingTerms: [], termDirty: false, frozen: null },

  // —— English：审校队列容量演示 ——
  // 顾宁手里已有 8 条（1 条刚认领 + 7 条超时未交回），再认领会被拒绝
  { id: "c2", trackId: "en", start: 0, end: 2.8, source: S1, translated: "As the tide recedes, the pier emerges again.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(2), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h1", trackId: "en", start: 3.2, end: 6.5, source: S2, translated: "The repair team must reinforce it before the next tide.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(31), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h2", trackId: "en", start: 7.0, end: 10.0, source: "木桩上的盐渍记录着每一次潮位。", translated: "Salt stains on the pilings record every tide level.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(26), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h3", trackId: "en", start: 10.4, end: 13.8, source: "海风把锈迹磨成了暗红色。", translated: "Sea wind grinds the rust into dark red.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(22), opinions: [{ id: "op-h3", reviewer: "审校-白鹭", note: "上一轮：时间码与下一条重叠 0.3 秒（已调整，意见留档）。", time: minutesAgo(120), status: "已采纳" }], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h4", trackId: "en", start: 14.2, end: 17.5, source: "灯塔看守人记得每一艘失踪的船。", translated: "The lighthouse keeper remembers every missing ship.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(18), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h5", trackId: "en", start: 18.0, end: 21.2, source: "潮水把缆绳绷得像一根弦。", translated: "The tide pulls the mooring line taut like a string.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(16), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h6", trackId: "en", start: 21.8, end: 25.0, source: "修复用的木材在岸边晾晒了三天。", translated: "Timber for repairs has dried on the shore for three days.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(14), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  { id: "h7", trackId: "en", start: 25.6, end: 28.4, source: "夜里的码头只剩下风声。", translated: "At night only wind remains on the pier.", status: "待审", translator: "林岚", heldBy: "审校-顾宁", heldAt: minutesAgo(12), opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  // 队列里还能认领的字幕
  { id: "p1", trackId: "en", start: 29.0, end: 32.0, source: "明天之前，码头必须重新开放。", translated: "The pier must reopen before tomorrow.", status: "待审", translator: "林岚", heldBy: null, heldAt: null, opinions: [], pendingTerms: [], termDirty: false, frozen: null },
  // 已通过一条（加固用的是建议术语）
  { id: "c-app", trackId: "en", start: 32.5, end: 36.0, source: "加固完成后，码头能承受更大的风浪。", translated: "After reinforcement, the pier can withstand rougher seas.", status: "已通过", translator: "林岚", heldBy: null, heldAt: null, opinions: [], pendingTerms: [], termDirty: false, frozen: { translated: "After reinforcement, the pier can withstand rougher seas.", start: 32.5, end: 36.0, time: minutesAgo(60 * 24) } },
  // 术语 pier 刚改成 wharf：用到旧译法的已通过字幕退回待审，通过版本继续冻结
  { id: "c-old", trackId: "en", start: 36.5, end: 39.5, source: "雾里的码头只剩一道剪影。", translated: "The pier is reduced to a silhouette in the fog.", status: "待审", translator: "林岚", heldBy: null, heldAt: null, opinions: [], pendingTerms: [{ termId: "g2", source: "码头", oldTarget: "pier", newTarget: "wharf" }], termDirty: true, frozen: { translated: "The pier is reduced to a silhouette in the fog.", start: 36.5, end: 39.5, time: minutesAgo(60 * 20) } },
  // 同一条被两名审校员退回，留两份意见
  { id: "c-ret", trackId: "en", start: 40.0, end: 43.2, source: "码头工人在潮间带捡到一只旧浮标。", translated: "Worker find a old buoy near the pier.", status: "退回", translator: "林岚", heldBy: null, heldAt: null, opinions: [
    { id: "op-1", reviewer: "审校-顾宁", note: "语法错误：Worker find a old buoy，应为 Workers found an old buoy。", time: minutesAgo(90), status: "未采纳" },
    { id: "op-2", reviewer: "审校-白鹭", note: "“潮间带”漏译，建议补出 intertidal zone；整条偏长可拆分。", time: minutesAgo(40), status: "未采纳" }
  ], pendingTerms: [], termDirty: false, frozen: null },
  // 翻译中草稿
  { id: "c-draft", trackId: "en", start: 44.0, end: 47.0, source: "远处传来引航船的汽笛。", translated: "A pilot boat's horn sounds in the distance.", status: "翻译中", translator: "林岚", heldBy: null, heldAt: null, opinions: [], pendingTerms: [], termDirty: false, frozen: null },

  // —— 日本語：尚未翻译，交付会被审校挡住 ——
  { id: "c4", trackId: "ja", start: 0, end: 2.8, source: S1, translated: "潮が引くと、桟橋が再び姿を現す。", status: "待译", translator: "周野", heldBy: null, heldAt: null, opinions: [], pendingTerms: [], termDirty: false, frozen: null }
];

const seedTerms: GlossaryTerm[] = [
  { id: "g1", locale: "en", source: "潮汐", target: "tide", prevTarget: null, status: "已锁定", owner: "术语管理员", updatedAt: null },
  { id: "g2", locale: "en", source: "码头", target: "wharf", prevTarget: "pier", status: "已锁定", owner: "术语管理员", updatedAt: minutesAgo(30) },
  { id: "g3", locale: "en", source: "加固", target: "reinforce", prevTarget: null, status: "建议", owner: "林岚", updatedAt: null },
  { id: "g4", locale: "ja", source: "潮汐", target: "潮", prevTarget: null, status: "已锁定", owner: "术语管理员", updatedAt: null },
  { id: "g5", locale: "ja", source: "码头", target: "桟橋", prevTarget: null, status: "已锁定", owner: "术语管理员", updatedAt: null }
];

const stored = browser && localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY)!) : null;

export const tracks = writable<Track[]>(seedTracks);
export const cues = writable<Cue[]>(stored?.cues ?? seedCues);
export const terms = writable<GlossaryTerm[]>(stored?.terms ?? seedTerms);
export const reviewEvents = writable<ReviewEvent[]>(stored?.events ?? []);
export const snapshots = writable<Snapshot[]>(stored?.snapshots ?? []);
export const conflicts = writable<TimelineConflict[]>([{ id: "x1", cueId: "c2", message: "协作者将结束时间调整为 3.0 秒，与本机存在 0.2 秒差异。", remoteStart: 0, remoteEnd: 3, status: "待处理" }]);
export const activeTrackId = writable("en");
export const selectedCueId = writable("c2");
export const reviewers = ["审校-顾宁", "审校-白鹭"] as const;
export const reviewer = writable<string>(stored?.reviewer ?? "审校-顾宁");
export type TabId = "timeline" | "review" | "terms" | "delivery";
export const activeTab = writable<TabId>("timeline");

function defaultDelivery(): Record<string, DeliveryItem> {
  return Object.fromEntries(seedTracks.map((track) => [track.id, {
    locale: track.id, trackName: track.name, status: "未尝试", attempts: 0,
    content: null, cueCount: 0, reason: null, error: null, time: null
  } satisfies DeliveryItem]));
}
export const delivery = writable<Record<string, DeliveryItem>>(stored?.delivery ?? defaultDelivery());
/** 模拟下一门语言导出时发生故障（一次性，触发后清除） */
export const failNextLocale = writable<string>(stored?.failNextLocale ?? "");

export const notices = writable<Notice[]>([]);

export function pushNotice(text: string, kind: NoticeKind = "info") {
  const id = crypto.randomUUID();
  notices.update((items) => [...items, { id, text, kind }]);
  setTimeout(() => notices.update((items) => items.filter((item) => item.id !== id)), 4000);
}

function persist() {
  if (!browser) return;
  localStorage.setItem(KEY, JSON.stringify({
    cues: get(cues), terms: get(terms), events: get(reviewEvents),
    snapshots: get(snapshots), delivery: get(delivery),
    reviewer: get(reviewer), failNextLocale: get(failNextLocale)
  }));
}
[tracks, cues, terms, reviewEvents, snapshots, delivery, reviewer, failNextLocale].forEach((store) => store.subscribe(persist));

function logEvent(cue: Cue | undefined, action: ReviewAction, detail: string, actor?: string) {
  reviewEvents.update((items) => [{ id: crypto.randomUUID(), cueId: cue?.id ?? "", action, detail, actor: actor ?? get(reviewer), time: nowIso() }, ...items]);
}

// ——————————————————————— 字幕编辑 ———————————————————————

const CONTENT_FIELDS = ["translated", "source", "start", "end"] as const;

/**
 * 普通编辑入口：已通过字幕一旦改动译文/原文/时间码，通过状态立即失效，
 * 退回待审重新确认；冻结的通过版本保留在 cue.frozen。
 */
export function updateCue(id: string, patch: Partial<Cue>) {
  const before = get(cues).find((cue) => cue.id === id);
  if (!before) return;
  cues.update((items) => items.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
  const after = get(cues).find((cue) => cue.id === id)!;
  const touched = CONTENT_FIELDS.some((field) => patch[field] !== undefined && patch[field] !== before[field]);
  if (touched && before.status === "已通过" && after.status === "已通过") {
    cues.update((items) => items.map((cue) => (cue.id === id ? { ...cue, status: "待审" as CueStatus } : cue)));
    logEvent(after, "重新确认", "已通过字幕的内容或时间码被改动，撤回通过状态，冻结版本继续保留");
    pushNotice("已通过的字幕改动后需重新确认，不能接着算通过", "warn");
  }
}

export function nudgeCue(id: string, delta: number) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, { start: Math.max(0, Number((cue.start + delta).toFixed(1))), end: Math.max(cue.start + 0.5, Number((cue.end + delta).toFixed(1))) });
}

export function splitCue(id: string) {
  const list = get(cues);
  const cue = list.find((item) => item.id === id);
  if (!cue || cue.end - cue.start < 1) return;
  const middle = Number(((cue.start + cue.end) / 2).toFixed(1));
  // 拆分后两条都失去原状态（首条保留冻结版本备查），需要重新走审校
  const first: Cue = { ...cue, end: middle, status: "翻译中", heldBy: null, heldAt: null };
  const second: Cue = { ...cue, id: crypto.randomUUID(), start: middle, translated: "", status: "待译", heldBy: null, heldAt: null, opinions: [], pendingTerms: [], termDirty: false, frozen: null };
  cues.set(list.flatMap((item) => (item.id === id ? [first, second] : item)));
  selectedCueId.set(second.id);
  if (cue.status === "已通过") pushNotice("已通过字幕拆分后两条均需重新确认", "warn");
}

export function mergeNext(id: string) {
  const list = [...get(cues)].sort((a, b) => a.start - b.start).filter((item) => item.trackId === get(activeTrackId));
  const index = list.findIndex((item) => item.id === id);
  const current = list[index];
  const next = list[index + 1];
  if (!current || !next) return;
  const wasApproved = current.status === "已通过" || next.status === "已通过";
  cues.update((items) => items
    .filter((item) => item.id !== next.id)
    .map((item) => (item.id === id ? { ...item, end: next.end, translated: `${item.translated} ${next.translated}`.trim(), status: "翻译中" as CueStatus, heldBy: null, heldAt: null } : item)));
  if (wasApproved) {
    logEvent(current, "重新确认", "合并涉及已通过字幕，合并结果需重新确认");
    pushNotice("合并了已通过字幕，新字幕需重新确认", "warn");
  }
}

export function setCueStatus(id: string, status: CueStatus) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  if (status === "待审") {
    // 译员提交 / 据退回意见修改后重新提交：放回队列，意见全部留档
    cues.update((items) => items.map((item) => (item.id === id ? { ...item, status, heldBy: null, heldAt: null } : item)));
    logEvent(cue, "提交审校", cue.translated || "(空译文)");
  } else {
    cues.update((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
  }
}

// ——————————————————————— 审校队列 ———————————————————————

export function heldCount(reviewerName: string): number {
  return get(cues).filter((cue) => cue.heldBy === reviewerName && cue.status === "待审").length;
}

export function isStale(cue: Cue, at = Date.now()): boolean {
  return !!cue.heldBy && !!cue.heldAt && at - new Date(cue.heldAt).getTime() > HOLD_TIMEOUT_MS;
}

/** 认领一条字幕；队列超过容量上限（8 条）时拒绝 */
export function takeForReview(id: string): boolean {
  const cue = get(cues).find((item) => item.id === id);
  const me = get(reviewer);
  if (!cue) return false;
  if (cue.status !== "待审" || cue.heldBy) {
    pushNotice("该字幕不在待认领队列中", "error");
    return false;
  }
  if (heldCount(me) >= MAX_HELD_PER_REVIEWER) {
    pushNotice(`审校员 ${me} 已带走 ${MAX_HELD_PER_REVIEWER} 条，队列容量已满，拒绝入队`, "error");
    return false;
  }
  cues.update((items) => items.map((item) => (item.id === id ? { ...item, heldBy: me, heldAt: nowIso() } : item)));
  logEvent(cue, "认领审校", `${me} 认领（容量 ${heldCount(me)}/${MAX_HELD_PER_REVIEWER}）`);
  return true;
}

/** 一键认领队列里的字幕，认满 8 条为止；返回新认领的条数 */
export function takeUpToCapacity(): number {
  const me = get(reviewer);
  let taken = 0;
  for (const cue of [...get(cues)].sort((a, b) => a.start - b.start)) {
    if (heldCount(me) >= MAX_HELD_PER_REVIEWER) break;
    if (cue.status === "待审" && !cue.heldBy && takeForReview(cue.id)) taken++;
  }
  if (taken === 0 && heldCount(me) >= MAX_HELD_PER_REVIEWER) {
    pushNotice(`已达容量上限 ${MAX_HELD_PER_REVIEWER} 条，无法继续认领`, "warn");
  }
  return taken;
}

/** 主动放行：把自己认领的字幕放回队列，备注/意见保留 */
export function releaseHeld(id: string) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue?.heldBy) return;
  if (cue.heldBy !== get(reviewer)) {
    pushNotice(`该字幕在 ${cue.heldBy} 名下，不能由你放回`, "error");
    return;
  }
  cues.update((items) => items.map((item) => (item.id === id ? { ...item, heldBy: null, heldAt: null } : item)));
  logEvent(cue, "放回队列", "审校员主动放回，备注与历史意见保留");
  pushNotice("字幕已放回队列，备注保留", "info");
}

/** 长时间没人交回的字幕统一放回队列（意见/备注保留） */
export function reclaimStaleHolds(): number {
  const stale = get(cues).filter((cue) => cue.status === "待审" && isStale(cue));
  if (!stale.length) {
    pushNotice("没有超时未交回的字幕", "info");
    return 0;
  }
  cues.update((items) => items.map((cue) => (stale.some((item) => item.id === cue.id) ? { ...cue, heldBy: null, heldAt: null } : cue)));
  stale.forEach((cue) => logEvent(cue, "超时收回", `${cue.heldBy} 超过 10 分钟未交回，放回队列，备注保留`, "系统"));
  pushNotice(`已将 ${stale.length} 条超时字幕放回队列，备注全部保留`, "success");
  return stale.length;
}

/** 审校通过：冻结当前版本；有未应用的术语变更时不允许通过 */
export function reviewCue(id: string, approved: boolean, note = "") {
  const cue = get(cues).find((item) => item.id === id);
  const me = get(reviewer);
  if (!cue) return;
  if (cue.heldBy !== me) {
    pushNotice(cue.heldBy ? `该字幕由 ${cue.heldBy} 认领，请先放回队列` : "请先在审校队列认领该字幕", "error");
    return;
  }
  if (approved) {
    if (cue.pendingTerms.length) {
      pushNotice("术语译法有更新，请先按当前译法修改再通过", "error");
      return;
    }
    const frozen: FrozenVersion = { translated: cue.translated, start: cue.start, end: cue.end, time: nowIso() };
    cues.update((items) => items.map((item) => (item.id === id ? {
      ...item, status: "已通过" as CueStatus, heldBy: null, heldAt: null,
      pendingTerms: [], termDirty: false, frozen
    } : item)));
    logEvent(cue, "审校通过", `冻结版本：${cue.translated}`);
    pushNotice("已通过并冻结当前版本", "success");
  } else {
    const opinion: ReviewOpinion = { id: crypto.randomUUID(), reviewer: me, note: note || "请核对术语和断句", time: nowIso(), status: "未采纳" };
    cues.update((items) => items.map((item) => (item.id === id ? {
      ...item, status: "退回" as CueStatus, heldBy: null, heldAt: null,
      opinions: [...item.opinions, opinion]
    } : item)));
    logEvent(cue, "退回修改", `${me}：${opinion.note}`);
    pushNotice("已退回并保留审校意见", "warn");
  }
}

/** 批量通过自己认领的全部字幕（术语变更未处理的会被跳过） */
export function approveAllHeld(): number {
  const me = get(reviewer);
  const mine = get(cues).filter((cue) => cue.heldBy === me && cue.status === "待审");
  let done = 0;
  for (const cue of mine) {
    if (!cue.pendingTerms.length) {
      reviewCue(cue.id, true);
      done++;
    }
  }
  const skipped = mine.length - done;
  if (skipped) pushNotice(`${skipped} 条因术语变更未应用而跳过`, "warn");
  return done;
}

/** 采纳某一份退回意见；其余意见保持未采纳、继续可查 */
export function adoptOpinion(cueId: string, opinionId: string) {
  const cue = get(cues).find((item) => item.id === cueId);
  if (!cue) return;
  cues.update((items) => items.map((item) => (item.id === cueId ? {
    ...item,
    opinions: item.opinions.map((op) => ({ ...op, status: op.id === opinionId ? "已采纳" as const : op.status }))
  } : item)));
  const target = cue.opinions.find((op) => op.id === opinionId);
  logEvent(cue, "退回修改", `采纳 ${target?.reviewer} 的意见，其余意见仍留档可查`);
  pushNotice("已采纳该意见，另一份意见仍可在记录中查看", "success");
}

// ——————————————————————— 术语库 ———————————————————————

export function lockTerm(id: string) {
  terms.update((items) => items.map((term) => (term.id === id ? { ...term, status: "已锁定", owner: "术语管理员" } : term)));
  const term = get(terms).find((item) => item.id === id);
  logEvent(undefined, "术语锁定", `${term?.source} → ${term?.target}（${term?.locale}）`, "术语管理员");
  pushNotice(`术语已锁定：${term?.source} → ${term?.target}`, "success");
}

/**
 * 变更锁定术语的译法：所有用到旧译法的字幕挂起待确认并退回待审；
 * 先前已通过的版本继续冻结在 cue.frozen。
 */
export function updateTermTarget(id: string, rawTarget: string) {
  const newTarget = rawTarget.trim();
  const term = get(terms).find((item) => item.id === id);
  if (!term) return;
  if (term.status !== "已锁定") {
    pushNotice("只有已锁定术语才能发起译法变更", "error");
    return;
  }
  if (!newTarget || newTarget === term.target) return;
  const oldTarget = term.target;
  terms.update((items) => items.map((item) => (item.id === id ? { ...item, target: newTarget, prevTarget: oldTarget, updatedAt: nowIso() } : item)));

  let affected = 0;
  cues.update((items) => items.map((cue) => {
    if (cue.trackId !== term.locale || !cue.translated.includes(oldTarget)) return cue;
    affected++;
    const pending: PendingTermChange[] = cue.pendingTerms.some((p) => p.termId === id)
      ? cue.pendingTerms.map((p) => (p.termId === id ? { ...p, newTarget } : p))
      : [...cue.pendingTerms, { termId: id, source: term.source, oldTarget, newTarget }];
    const backToReview = cue.status === "已通过" || cue.status === "退回";
    return {
      ...cue,
      pendingTerms: pending,
      termDirty: true,
      status: backToReview ? "待审" as CueStatus : cue.status,
      heldBy: backToReview ? null : cue.heldBy,
      heldAt: backToReview ? null : cue.heldAt
    };
  }));

  get(cues).filter((cue) => cue.pendingTerms.some((p) => p.termId === id) && cue.translated.includes(newTarget) === false && cue.translated.includes(oldTarget))
    .forEach((cue) => logEvent(cue, "术语译法变更", `「${term.source}」译法 ${oldTarget} → ${newTarget}，退回待审；已通过版本继续冻结`, "术语管理员"));
  if (affected) pushNotice(`「${term.source}」译法已变更，${affected} 条字幕退回待审，通过版本继续冻结`, "success");
  else pushNotice(`「${term.source}」译法已变更，当前没有用到旧译法的字幕`, "info");
}

/** 把一条字幕上挂起的术语变更全部按当前译法落到译文（仍需重新审校确认） */
export function applyPendingTerms(cueId: string) {
  const cue = get(cues).find((item) => item.id === cueId);
  if (!cue || !cue.pendingTerms.length) return;
  let translated = cue.translated;
  for (const change of cue.pendingTerms) translated = translated.split(change.oldTarget).join(change.newTarget);
  cues.update((items) => items.map((item) => (item.id === cueId ? { ...item, translated, pendingTerms: [], termDirty: false } : item)));
  logEvent(cue, "术语译法变更", "已按当前译法更新译文，等待重新审校确认");
  pushNotice("已按当前译法更新，仍需重新审校确认", "success");
}

/** 编辑译文时按当前（锁定）译法插入术语 */
export function insertLockedTerm(cueId: string, termId: string) {
  const cue = get(cues).find((item) => item.id === cueId);
  const term = get(terms).find((item) => item.id === termId);
  if (!cue || !term || term.status !== "已锁定") return;
  if (cue.trackId !== term.locale) {
    pushNotice("该术语不属于当前语言轨道", "error");
    return;
  }
  const joiner = term.locale === "ja" ? "" : " ";
  const next = cue.translated ? `${cue.translated}${joiner}${term.target}` : term.target;
  updateCue(cueId, { translated: next });
}

// ——————————————————————— 快照 / 冲突 ———————————————————————

export function createSnapshot(name = `时间轴快照 ${get(snapshots).length + 1}`) {
  snapshots.update((items) => [{ id: crypto.randomUUID(), name, time: nowIso(), cues: structuredClone(get(cues)) }, ...items].slice(0, 12));
  pushNotice("已保存时间轴快照", "success");
}

export function restoreSnapshot(id: string) {
  const snapshot = get(snapshots).find((item) => item.id === id);
  if (snapshot) {
    cues.set(structuredClone(snapshot.cues));
    pushNotice("已恢复快照，字幕状态以快照为准", "info");
  }
}

export function resolveConflict(id: string, resolution: TimelineConflict["status"]) {
  conflicts.update((items) => items.map((item) => (item.id === id ? { ...item, status: resolution } : item)));
  if (resolution === "采用协作版本") {
    const conflict = get(conflicts).find((item) => item.id === id);
    if (conflict) updateCue(conflict.cueId, { start: conflict.remoteStart, end: conflict.remoteEnd });
  }
}

// ——————————————————————— 交付准备（按语言分别处理） ———————————————————————

export function computeReadiness(locale: string, at = Date.now()): Readiness {
  const list = get(cues).filter((cue) => cue.trackId === locale);
  const approved = list.filter((cue) => cue.status === "已通过");
  const pending = list.filter((cue) => cue.status === "待审");
  const rejected = list.filter((cue) => cue.status === "退回");
  const draft = list.filter((cue) => cue.status === "待译" || cue.status === "翻译中");
  const blockers: string[] = [];
  // 原语轨道无需审校/术语闸门
  if (locale !== "zh") {
    const termCues = list.filter((cue) => cue.status === "待审" && cue.pendingTerms.length > 0);
    if (termCues.length) blockers.push(`术语：${termCues.length} 条字幕受译法变更影响，等待重新确认`);
    const notApproved = list.filter((cue) => cue.status !== "已通过");
    if (notApproved.length) {
      const parts: string[] = [];
      if (pending.length) parts.push(`待审 ${pending.length}`);
      if (rejected.length) parts.push(`退回 ${rejected.length}`);
      const translating = draft.filter((cue) => cue.status === "翻译中").length;
      const untranslated = draft.filter((cue) => cue.status === "待译").length;
      if (translating) parts.push(`翻译中 ${translating}`);
      if (untranslated) parts.push(`待译 ${untranslated}`);
      blockers.push(`审校：${notApproved.length} 条字幕尚未通过（${parts.join(" · ")}）`);
    }
  }
  return {
    total: list.length,
    approved: approved.length,
    pending: pending.length,
    rejected: rejected.length,
    draft: draft.length,
    held: list.filter((cue) => !!cue.heldBy).length,
    stale: list.filter((cue) => cue.status === "待审" && isStale(cue, at)).length,
    termReconfirm: list.filter((cue) => cue.pendingTerms.length > 0).length,
    blockers
  };
}

export const readiness = derived(cues, ($cues) => {
  void $cues;
  return Object.fromEntries(get(tracks).map((track) => [track.id, computeReadiness(track.id)]));
});

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (v: number, n = 2) => String(v).padStart(n, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

export function buildSrt(locale: string): { content: string; count: number } | null {
  const list = get(cues).filter((cue) => cue.trackId === locale).sort((a, b) => a.start - b.start);
  if (!list.length) return null;
  const blocks = list.map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.translated}`);
  return { content: blocks.join("\n\n") + "\n", count: list.length };
}

/**
 * 准备交付：逐门语言处理。
 * - 已生成的原封不动；被挡住的标注原因后继续处理其他语言；
 * - 一门导出失败立即停止，已备好的保留，重试时只做剩下的。
 */
export function prepareDeliveries() {
  const failLocale = get(failNextLocale);
  delivery.update((items) => {
    const next = structuredClone(items);
    for (const track of get(tracks)) {
      const item = next[track.id];
      if (!item || item.status === "已生成") continue; // 已备好的先留着
      const gates = computeReadiness(track.id).blockers;
      if (gates.length) {
        item.status = "被挡住";
        item.reason = gates.join("；");
        item.error = null;
        continue;
      }
      item.attempts += 1;
      if (failLocale === track.id) {
        item.status = "失败";
        item.error = "模拟的导出服务故障（503）";
        item.time = nowIso();
        break; // 一门失败：停止批处理，剩余语言保持原状
      }
      const srt = buildSrt(track.id);
      item.status = "已生成";
      item.content = srt?.content ?? "";
      item.cueCount = srt?.count ?? 0;
      item.reason = null;
      item.error = null;
      item.time = nowIso();
    }
    return next;
  });
  if (failLocale) failNextLocale.set("");
  const summary = get(tracks).map((track) => {
    const item = get(delivery)[track.id];
    return `${track.name}：${item.status}`;
  }).join("；");
  logEvent(undefined, "交付准备", summary, "制作人");
  const result = get(delivery);
  const generated = Object.values(result).filter((item) => item.status === "已生成").length;
  const blocked = Object.values(result).filter((item) => item.status === "被挡住").length;
  const failed = Object.values(result).filter((item) => item.status === "失败").length;
  pushNotice(`交付准备完成：已生成 ${generated} 门，挡住 ${blocked} 门，失败 ${failed} 门`, failed ? "warn" : "success");
}

/** 导出说明：写清哪几门已生成、哪几门被术语或审校挡住、失败与未处理 */
export function buildManifest(): string {
  const items = get(tracks).map((track) => ({ track, item: get(delivery)[track.id], readiness: computeReadiness(track.id) }));
  const lines: string[] = [];
  lines.push("# 交付导出说明");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push("");
  const section = (title: string, predicate: (i: (typeof items)[number]) => boolean) => {
    const rows = items.filter(predicate);
    lines.push(`## ${title}（${rows.length}）`);
    if (!rows.length) lines.push("- 无");
    for (const { track, item, readiness: r } of rows) {
      if (item.status === "已生成") lines.push(`- ${track.name}（${track.locale}）：已生成 ${item.cueCount} 条字幕，第 ${item.attempts} 次尝试，${item.time ? new Date(item.time).toLocaleString("zh-CN") : ""}`);
      if (item.status === "被挡住") lines.push(`- ${track.name}（${track.locale}）：被挡住 — ${item.reason ?? r.blockers.join("；")}`);
      if (item.status === "失败") lines.push(`- ${track.name}（${track.locale}）：导出失败（第 ${item.attempts} 次尝试）— ${item.error}；已生成的其他语言不受影响，重试只处理剩余语言`);
      if (item.status === "未尝试") lines.push(`- ${track.name}（${track.locale}）：尚未处理`);
    }
    lines.push("");
  };
  section("已生成", (i) => i.item.status === "已生成");
  section("被术语或审校挡住", (i) => i.item.status === "被挡住");
  section("导出失败", (i) => i.item.status === "失败");
  section("未处理", (i) => i.item.status === "未尝试");
  lines.push("## 各语言当前进度");
  for (const { track, readiness: r } of items) {
    lines.push(`- ${track.name}（${track.locale}）：共 ${r.total} 条，已通过 ${r.approved}，待审 ${r.pending}（含术语重审 ${r.termReconfirm}），退回 ${r.rejected}，草稿 ${r.draft}，审校借出 ${r.held}（超时 ${r.stale}）`);
  }
  return lines.join("\n");
}

// ——————————————————————— 派生数据 ———————————————————————

export const activeCues = derived([cues, activeTrackId, selectedCueId], ([$cues, $activeTrackId, $selectedCueId]) =>
  $cues.filter((cue) => cue.trackId === $activeTrackId).sort((a, b) => a.start - b.start).map((cue) => ({ ...cue, selected: cue.id === $selectedCueId })));

/** 待认领队列（按当前轨道过滤） */
export const queueCues = derived([cues, activeTrackId], ([$cues, $activeTrackId]) =>
  $cues.filter((cue) => cue.trackId === $activeTrackId && cue.status === "待审" && !cue.heldBy).sort((a, b) => a.start - b.start));

export const myHeldCues = derived([cues, reviewer], ([$cues, $reviewer]) =>
  $cues.filter((cue) => cue.heldBy === $reviewer && cue.status === "待审").sort((a, b) => new Date(a.heldAt!).getTime() - new Date(b.heldAt!).getTime()));

export const rejectedCues = derived(cues, ($cues) => $cues.filter((cue) => cue.status === "退回").sort((a, b) => a.start - b.start));
