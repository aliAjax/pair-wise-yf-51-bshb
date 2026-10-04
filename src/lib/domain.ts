// 纯领域逻辑：审校队列容量 / 超时放回 / 术语联动 / 交付准备。
// 不依赖 SvelteKit，便于直接用 node 验证规则。

export const REVIEW_CAPACITY = 8;
export const CHECKOUT_TIMEOUT_MS = 5 * 60 * 1000;

export type TrackStatus = "草稿" | "审校中" | "已通过" | "需修改";
export type CueStatus = "待译" | "翻译中" | "待审" | "已通过" | "退回";
export type TermStatus = "建议" | "已锁定";
export type DeliveryStatus = "未准备" | "已生成" | "被挡住";
export type BlockKind = "审校" | "术语";

export interface FrozenVersion {
  translated: string;
  source: string;
  start: number;
  end: number;
  approvedAt: string;
  approvedBy: string;
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
  reviewerNote: string;
  needsReconfirm: boolean;
  termStale: boolean;
  frozen: FrozenVersion | null;
}

export interface Track {
  id: string;
  name: string;
  locale: string;
  status: TrackStatus;
  delivery: DeliveryStatus;
  blockedBy: BlockKind[];
  deliveryNote: string;
  deliveryContent: string;
  deliveredAt: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  status: TermStatus;
  owner: string;
  lockedTarget: string;
}

export interface ReviewOpinion {
  id: string;
  cueId: string;
  reviewer: string;
  note: string;
  createdAt: string;
  adopted: boolean;
}

export interface CheckoutSlot {
  cueId: string;
  reviewer: string;
  checkedOutAt: string;
}

export function canEnqueue(queue: string[]): boolean {
  return queue.length < REVIEW_CAPACITY;
}

export interface EnqueueResult {
  ok: boolean;
  queue: string[];
  error?: string;
}

export function enqueueCueId(queue: string[], cueId: string): EnqueueResult {
  if (queue.includes(cueId)) return { ok: false, queue, error: "该字幕已在审校队列中" };
  if (!canEnqueue(queue)) {
    return { ok: false, queue, error: `审校队列已满（上限 ${REVIEW_CAPACITY} 条），拒绝入队` };
  }
  return { ok: true, queue: [...queue, cueId] };
}

export interface TakeResult {
  ok: boolean;
  queue: string[];
  slots: CheckoutSlot[];
  taken: string[];
  error?: string;
}

// 审校员一次最多带走八条：名下未交回的占用容量，队列中的可带走。
export function takeCueIds(
  queue: string[],
  held: CheckoutSlot[],
  ids: string[],
  reviewer: string,
  now: number
): TakeResult {
  const already = held.filter((slot) => slot.reviewer === reviewer).length;
  const room = REVIEW_CAPACITY - already;
  if (room <= 0) {
    return { ok: false, queue, slots: [], taken: [], error: `你名下已有 ${REVIEW_CAPACITY} 条未交回，达到上限` };
  }
  const wanted = ids.filter((id) => queue.includes(id));
  const taken = wanted.slice(0, Math.max(0, room));
  if (!taken.length) {
    return { ok: false, queue, slots: [], taken: [], error: "队列中没有可带走的字幕" };
  }
  const slots: CheckoutSlot[] = taken.map((cueId) => ({
    cueId,
    reviewer,
    checkedOutAt: new Date(now).toISOString()
  }));
  return {
    ok: true,
    queue: queue.filter((id) => !taken.includes(id)),
    slots,
    taken
  };
}

export function isTimedOut(slot: CheckoutSlot, now: number): boolean {
  return now - new Date(slot.checkedOutAt).getTime() > CHECKOUT_TIMEOUT_MS;
}

export interface ReleaseResult {
  released: CheckoutSlot[];
  remaining: CheckoutSlot[];
}

export function releaseTimedOutSlots(held: CheckoutSlot[], now: number): ReleaseResult {
  const released = held.filter((slot) => isTimedOut(slot, now));
  return { released, remaining: held.filter((slot) => !isTimedOut(slot, now)) };
}

export function remainingMs(slot: CheckoutSlot, now: number): number {
  return Math.max(0, CHECKOUT_TIMEOUT_MS - (now - new Date(slot.checkedOutAt).getTime()));
}

// 术语译法变动后，译文里仍在用旧译法的字幕需要重新确认。
export function cuesWithOldTarget(cues: Cue[], oldTarget: string): Cue[] {
  if (!oldTarget) return [];
  return cues.filter((cue) => cue.translated.includes(oldTarget));
}

export interface Readiness {
  canDeliver: boolean;
  blockedBy: BlockKind[];
  pendingCount: number;
  termIssueCount: number;
  reasons: string[];
}

export function trackReadiness(track: Track, cues: Cue[]): Readiness {
  const list = cues.filter((cue) => cue.trackId === track.id);
  const reasons: string[] = [];
  const blockedBy = new Set<BlockKind>();
  let pendingCount = 0;
  let termIssueCount = 0;
  for (const cue of list) {
    if (cue.termStale) {
      termIssueCount += 1;
      blockedBy.add("术语");
      reasons.push(`字幕 ${cue.id}：术语译法已变动，需重新确认`);
    } else if (cue.needsReconfirm) {
      pendingCount += 1;
      blockedBy.add("审校");
      reasons.push(`字幕 ${cue.id}：已通过后又改动，需重新确认`);
    } else if (cue.status !== "已通过") {
      pendingCount += 1;
      blockedBy.add("审校");
      reasons.push(`字幕 ${cue.id}：状态为「${cue.status}」，未通过审校`);
    }
  }
  if (list.length === 0) reasons.push("该语言暂无字幕");
  return {
    canDeliver: list.length > 0 && blockedBy.size === 0,
    blockedBy: [...blockedBy],
    pendingCount,
    termIssueCount,
    reasons
  };
}

function srtTime(sec: number): string {
  const pad = (n: number, z = 2) => String(Math.floor(n)).padStart(z, "0");
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function renderDelivery(track: Track, cues: Cue[]): string {
  const list = cues
    .filter((cue) => cue.trackId === track.id)
    .sort((a, b) => a.start - b.start);
  return list
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.translated}\n`)
    .join("\n");
}

export function buildExportReport(tracks: Track[], cues: Cue[]): string {
  const lines: string[] = ["交付导出说明", "====================", ""];
  const ready = tracks.filter((t) => t.delivery === "已生成");
  const blocked = tracks.filter((t) => t.delivery === "被挡住");
  const pending = tracks.filter((t) => t.delivery === "未准备");

  lines.push(`已生成（${ready.length}）：${ready.map((t) => t.name).join("、") || "无"}`);
  for (const t of ready) {
    lines.push(`  - ${t.name}（${t.locale}）：已生成${t.deliveredAt ? "，于 " + new Date(t.deliveredAt).toLocaleString("zh-CN") : ""}`);
  }
  lines.push("");
  lines.push(`被挡住（${blocked.length}）：${blocked.map((t) => t.name).join("、") || "无"}`);
  for (const t of blocked) {
    lines.push(`  - ${t.name}（${t.locale}）：被 ${t.blockedBy.join("、") || "未知"} 挡住`);
    for (const reason of t.deliveryNote.split("\n")) {
      if (reason) lines.push(`      · ${reason}`);
    }
  }
  lines.push("");
  lines.push(`未准备（${pending.length}）：${pending.map((t) => t.name).join("、") || "无"}`);
  lines.push("");
  lines.push("说明：重试仅处理「未准备 / 被挡住」的语言，已生成的语言保留不动。");
  return lines.join("\n");
}
