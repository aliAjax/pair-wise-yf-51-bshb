import { browser } from "$app/environment";
import { derived, get, writable } from "svelte/store";
import {
  buildExportReport,
  cuesWithOldTarget,
  enqueueCueId,
  releaseTimedOutSlots,
  renderDelivery,
  takeCueIds,
  trackReadiness,
  type CheckoutSlot,
  type Cue,
  type CueStatus,
  type GlossaryTerm,
  type ReviewOpinion,
  type Track
} from "$lib/domain";

export type { Cue, Track, GlossaryTerm, ReviewOpinion, CheckoutSlot } from "$lib/domain";
export type { CueStatus, TrackStatus, TermStatus, DeliveryStatus, BlockKind, FrozenVersion } from "$lib/domain";

export interface ReviewEvent {
  id: string;
  cueId: string;
  action: "提交审校" | "审校通过" | "退回修改" | "术语锁定";
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

const KEY = "pair-wise-yf-51/subtitles-v1";

function normalizeTrack(t: Partial<Track>): Track {
  return {
    id: t.id ?? "",
    name: t.name ?? "",
    locale: t.locale ?? "zh",
    status: t.status ?? "草稿",
    delivery: t.delivery ?? "未准备",
    blockedBy: t.blockedBy ?? [],
    deliveryNote: t.deliveryNote ?? "",
    deliveryContent: t.deliveryContent ?? "",
    deliveredAt: t.deliveredAt ?? ""
  };
}

function normalizeCue(c: Partial<Cue>): Cue {
  return {
    id: c.id ?? "",
    trackId: c.trackId ?? "",
    start: c.start ?? 0,
    end: c.end ?? 1,
    source: c.source ?? "",
    translated: c.translated ?? "",
    status: c.status ?? "待译",
    translator: c.translator ?? "",
    reviewerNote: c.reviewerNote ?? "",
    needsReconfirm: c.needsReconfirm ?? false,
    termStale: c.termStale ?? false,
    frozen: c.frozen ?? null
  };
}

function normalizeTerm(t: Partial<GlossaryTerm>): GlossaryTerm {
  return {
    id: t.id ?? "",
    source: t.source ?? "",
    target: t.target ?? "",
    status: t.status ?? "建议",
    owner: t.owner ?? "",
    lockedTarget: t.lockedTarget ?? t.target ?? ""
  };
}

const seedTracks: Track[] = [
  { id: "zh", name: "中文原字幕", locale: "zh", status: "已通过", delivery: "未准备", blockedBy: [], deliveryNote: "", deliveryContent: "", deliveredAt: "" },
  { id: "en", name: "English 翻译", locale: "en", status: "审校中", delivery: "未准备", blockedBy: [], deliveryNote: "", deliveryContent: "", deliveredAt: "" },
  { id: "ja", name: "日本語訳", locale: "ja", status: "草稿", delivery: "未准备", blockedBy: [], deliveryNote: "", deliveryContent: "", deliveredAt: "" }
];
const seedCues: Cue[] = [
  { id: "c1", trackId: "zh", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮汐退去后，码头重新露出水面。", status: "已通过", translator: "系统", reviewerNote: "", needsReconfirm: false, termStale: false, frozen: null },
  { id: "c2", trackId: "en", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "As the tide recedes, the pier emerges again.", status: "待审", translator: "林岚", reviewerNote: "", needsReconfirm: false, termStale: false, frozen: null },
  { id: "c3", trackId: "en", start: 3.2, end: 6.5, source: "修复组必须在下一场潮水到来前完成加固。", translated: "The repair team must reinforce it before the next tide.", status: "翻译中", translator: "林岚", reviewerNote: "", needsReconfirm: false, termStale: false, frozen: null },
  { id: "c4", trackId: "ja", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮が引くと、桟橋が再び姿を現す。", status: "待译", translator: "周野", reviewerNote: "", needsReconfirm: false, termStale: false, frozen: null }
];
const seedTerms: GlossaryTerm[] = [
  { id: "g1", source: "潮汐", target: "tide", status: "已锁定", owner: "术语管理员", lockedTarget: "tide" },
  { id: "g2", source: "码头", target: "pier", status: "已锁定", owner: "术语管理员", lockedTarget: "pier" },
  { id: "g3", source: "加固", target: "reinforce", status: "建议", owner: "林岚", lockedTarget: "reinforce" }
];

function load<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const initial = browser ? localStorage.getItem(KEY) : null;
const parsed = initial ? JSON.parse(initial) : null;

export const tracks = writable<Track[]>((parsed?.tracks ?? seedTracks).map(normalizeTrack));
export const cues = writable<Cue[]>((parsed?.cues ?? seedCues).map(normalizeCue));
export const terms = writable<GlossaryTerm[]>((parsed?.terms ?? seedTerms).map(normalizeTerm));
export const reviewEvents = writable<ReviewEvent[]>(parsed?.events ?? []);
export const snapshots = writable<Snapshot[]>(parsed?.snapshots ?? []);
export const conflicts = writable<TimelineConflict[]>([
  { id: "x1", cueId: "c2", message: "协作者将结束时间调整为3.0秒，与本机存在0.2秒差异。", remoteStart: 0, remoteEnd: 3, status: "待处理" }
]);
export const activeTrackId = writable("en");
export const selectedCueId = writable("c2");
export const reviewer = writable("审校-顾宁");

// 审校队列：queue 为待取走的字幕 id，checkedOut 为已被带走、占用容量的记录。
export const reviewQueue = writable<string[]>(parsed?.reviewQueue ?? []);
export const checkedOut = writable<CheckoutSlot[]>(parsed?.checkedOut ?? []);
// 同一条字幕被多名审校退回时，各自留一份意见；采用一份后其余仍可查。
export const opinions = writable<ReviewOpinion[]>(parsed?.opinions ?? []);

function persist() {
  if (!browser) return;
  localStorage.setItem(
    KEY,
    JSON.stringify({
      tracks: get(tracks),
      cues: get(cues),
      terms: get(terms),
      events: get(reviewEvents),
      snapshots: get(snapshots),
      reviewQueue: get(reviewQueue),
      checkedOut: get(checkedOut),
      opinions: get(opinions)
    })
  );
}
[tracks, cues, terms, reviewEvents, snapshots, reviewQueue, checkedOut, opinions].forEach((store) =>
  store.subscribe(persist)
);

function event(cue: Cue | undefined, action: ReviewEvent["action"], detail: string) {
  reviewEvents.update((items) => [
    { id: crypto.randomUUID(), cueId: cue?.id ?? "", action, detail, actor: get(reviewer), time: new Date().toISOString() },
    ...items
  ]);
}

// 已通过的字幕改动后要重新确认：内容字段被改且当前为「已通过」时，退回待审。
export function updateCue(id: string, patch: Partial<Cue>, log = false) {
  cues.update((items) =>
    items.map((cue) => {
      if (cue.id !== id) return cue;
      const next = { ...cue, ...patch };
      const contentChanged = ["source", "translated", "start", "end"].some(
        (key) => key in patch && (patch as unknown as Record<string, unknown>)[key] !== (cue as unknown as Record<string, unknown>)[key]
      );
      if (contentChanged && cue.status === "已通过" && !("status" in patch)) {
        next.status = "待审";
        next.needsReconfirm = true;
      }
      return next;
    })
  );
  if (log) event(get(cues).find((cue) => cue.id === id), "退回修改", "编辑字幕内容或时间码");
}

export function nudgeCue(id: string, delta: number) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, {
    start: Math.max(0, Number((cue.start + delta).toFixed(1))),
    end: Math.max(cue.start + 0.5, Number((cue.end + delta).toFixed(1)))
  });
}

export function splitCue(id: string) {
  const list = get(cues);
  const cue = list.find((item) => item.id === id);
  if (!cue || cue.end - cue.start < 1) return;
  const middle = Number(((cue.start + cue.end) / 2).toFixed(1));
  const first = { ...cue, end: middle, translated: `${cue.translated}`, status: "翻译中" as CueStatus };
  const second = { ...cue, id: crypto.randomUUID(), start: middle, translated: "", status: "待译" as CueStatus };
  cues.set(list.flatMap((item) => (item.id === id ? [first, second] : [item])));
  selectedCueId.set(second.id);
}

export function mergeNext(id: string) {
  const list = [...get(cues)]
    .sort((a, b) => a.start - b.start)
    .filter((item) => item.trackId === get(activeTrackId));
  const index = list.findIndex((item) => item.id === id);
  const current = list[index];
  const next = list[index + 1];
  if (!current || !next) return;
  cues.update((items) =>
    items
      .filter((item) => item.id !== next.id)
      .map((item) =>
        item.id === id
          ? { ...item, end: next.end, translated: `${item.translated} ${next.translated}`.trim(), status: "翻译中" }
          : item
      )
  );
}

export function setCueStatus(id: string, status: CueStatus) {
  updateCue(id, { status });
  const cue = get(cues).find((item) => item.id === id);
  event(cue, status === "待审" ? "提交审校" : status === "已通过" ? "审校通过" : "退回修改", cue?.translated ?? "");
}

// 提交到审校队列：超过容量上限拒绝入队。
export function enqueueCue(id: string) {
  const result = enqueueCueId(get(reviewQueue), id);
  const cue = get(cues).find((item) => item.id === id);
  if (!result.ok) {
    event(cue, "提交审校", `拒绝入队：${result.error}`);
    return result;
  }
  reviewQueue.set(result.queue);
  if (cue && cue.status !== "待审") updateCue(id, { status: "待审" });
  event(cue, "提交审校", "加入审校队列");
  return result;
}

// 审校员带走队列中的字幕，名下最多八条。
export function takeCues(ids: string[]) {
  const actor = get(reviewer);
  const result = takeCueIds(get(reviewQueue), get(checkedOut), ids, actor, Date.now());
  if (!result.ok) {
    event(undefined, "提交审校", result.error ?? "无法带走");
    return result;
  }
  reviewQueue.set(result.queue);
  checkedOut.update((items) => [...items, ...result.slots]);
  result.taken.forEach((id) => {
    const cue = get(cues).find((item) => item.id === id);
    event(cue, "提交审校", `${actor} 带走审校`);
  });
  return result;
}

// 审校员交回：通过则冻结当前版本；退回则记录本人意见（可存在多份）。
export function reviewCue(id: string, approved: boolean, note = "") {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  const actor = get(reviewer);
  if (approved) {
    updateCue(id, {
      status: "已通过",
      reviewerNote: note,
      needsReconfirm: false,
      termStale: false,
      frozen: {
        translated: cue.translated,
        source: cue.source,
        start: cue.start,
        end: cue.end,
        approvedAt: new Date().toISOString(),
        approvedBy: actor
      }
    });
    event(cue, "审校通过", note || "审校通过，当前版本已冻结");
  } else {
    updateCue(id, { status: "退回", reviewerNote: note });
    opinions.update((items) => [
      {
        id: crypto.randomUUID(),
        cueId: id,
        reviewer: actor,
        note: note || "请核对术语和断句",
        createdAt: new Date().toISOString(),
        adopted: false
      },
      ...items
    ]);
    event(cue, "退回修改", note || cue.translated);
  }
  checkedOut.update((items) => items.filter((slot) => slot.cueId !== id));
}

// 采用某一份退回意见；其余意见保留、仍可查询。
export function adoptOpinion(cueId: string, opinionId: string) {
  opinions.update((items) =>
    items.map((opinion) => (opinion.cueId === cueId ? { ...opinion, adopted: opinion.id === opinionId } : opinion))
  );
  const opinion = get(opinions).find((item) => item.id === opinionId);
  if (opinion) updateCue(cueId, { reviewerNote: opinion.note, status: "退回" });
  const cue = get(cues).find((item) => item.id === cueId);
  event(cue, "退回修改", `采用 ${opinion?.reviewer} 的意见：${opinion?.note}`);
}

// 审校员主动放回队列（备注保留，不清空）。
export function returnToQueue(id: string) {
  const slot = get(checkedOut).find((item) => item.cueId === id);
  if (!slot) return;
  checkedOut.update((items) => items.filter((item) => item.cueId !== id));
  reviewQueue.update((queue) => (queue.includes(id) ? queue : [...queue, id]));
  const cue = get(cues).find((item) => item.id === id);
  event(cue, "提交审校", `${slot.reviewer} 放回队列（备注保留）`);
}

// 长时间没人交回的字幕自动放回队列，备注与意见保留。
export function releaseTimedOut() {
  const { released, remaining } = releaseTimedOutSlots(get(checkedOut), Date.now());
  if (!released.length) return released;
  checkedOut.set(remaining);
  reviewQueue.update((queue) => {
    const next = [...queue];
    released.forEach((slot) => {
      if (!next.includes(slot.cueId)) next.push(slot.cueId);
    });
    return next;
  });
  released.forEach((slot) => {
    const cue = get(cues).find((item) => item.id === slot.cueId);
    event(cue, "提交审校", `${slot.reviewer} 长时间未交回，自动放回队列（备注保留）`);
  });
  return released;
}

// 术语锁定：译文按当前译法执行，锁定译法作为基线。
export function lockTerm(id: string) {
  terms.update((items) =>
    items.map((term) => (term.id === id ? { ...term, status: "已锁定", owner: "术语管理员", lockedTarget: term.target } : term))
  );
  const term = get(terms).find((item) => item.id === id);
  event(get(cues).find((cue) => cue.id === get(selectedCueId)), "术语锁定", `${term?.source} → ${term?.target}`);
}

// 术语译法变动：用到旧译法的字幕退回待审、重新确认；先前通过的版本继续冻结保留。
export function updateTermTarget(id: string, newTarget: string) {
  const term = get(terms).find((item) => item.id === id);
  if (!term || term.target === newTarget) return;
  const oldTarget = term.target;
  terms.update((items) => items.map((item) => (item.id === id ? { ...item, target: newTarget } : item)));
  const affected = cuesWithOldTarget(get(cues), oldTarget);
  const affectedIds = new Set(affected.map((cue) => cue.id));
  if (affected.length) {
    cues.update((items) =>
      items.map((cue) => (affectedIds.has(cue.id) ? { ...cue, termStale: true, needsReconfirm: true, status: "待审" } : cue))
    );
  }
  event(
    undefined,
    "术语锁定",
    `术语「${term.source}」译法 ${oldTarget} → ${newTarget}，${affected.length} 条字幕需重新确认（已通过版本冻结保留）`
  );
}

export function createSnapshot(name = `时间轴快照 ${get(snapshots).length + 1}`) {
  snapshots.update((items) => [{ id: crypto.randomUUID(), name, time: new Date().toISOString(), cues: structuredClone(get(cues)) }, ...items].slice(0, 12));
}

export function restoreSnapshot(id: string) {
  const snapshot = get(snapshots).find((item) => item.id === id);
  if (snapshot) cues.set(structuredClone(snapshot.cues).map(normalizeCue));
}

export function resolveConflict(id: string, resolution: TimelineConflict["status"]) {
  conflicts.update((items) => items.map((item) => (item.id === id ? { ...item, status: resolution } : item)));
  if (resolution === "采用协作版本") {
    const conflict = get(conflicts).find((item) => item.id === id);
    if (conflict) updateCue(conflict.cueId, { start: conflict.remoteStart, end: conflict.remoteEnd });
  }
}

// 按语言分别准备交付：已生成的保留，被挡住的记录原因。
export function prepareDelivery(locale: string) {
  const track = get(tracks).find((item) => item.locale === locale);
  if (!track) return { ok: false as const, error: "语言不存在" };
  if (track.delivery === "已生成") return { ok: true as const, skipped: true, track };
  const readiness = trackReadiness(track, get(cues));
  if (readiness.canDeliver) {
    const content = renderDelivery(track, get(cues));
    tracks.update((items) =>
      items.map((item) =>
        item.locale === locale
          ? { ...item, delivery: "已生成", blockedBy: [], deliveryNote: "", deliveryContent: content, deliveredAt: new Date().toISOString() }
          : item
      )
    );
    const updated = get(tracks).find((item) => item.locale === locale);
    event(undefined, "审校通过", `语言「${track.name}」交付已生成`);
    return { ok: true as const, track: updated };
  }
  tracks.update((items) =>
    items.map((item) =>
      item.locale === locale
        ? { ...item, delivery: "被挡住", blockedBy: readiness.blockedBy, deliveryNote: readiness.reasons.join("\n"), deliveryContent: "" }
        : item
    )
  );
  const updated = get(tracks).find((item) => item.locale === locale);
  event(undefined, "退回修改", `语言「${track.name}」交付被挡住：${readiness.blockedBy.join("、")}`);
  return { ok: false as const, error: readiness.reasons.join("；"), track: updated };
}

// 重试只处理未准备 / 被挡住的语言，已生成的先留着。
export function retryDelivery() {
  const targets = get(tracks).filter((track) => track.delivery !== "已生成");
  const results = targets.map((track) => ({ locale: track.locale, ...prepareDelivery(track.locale) }));
  return { kept: get(tracks).filter((track) => track.delivery === "已生成"), results };
}

export function exportReport() {
  return buildExportReport(get(tracks), get(cues));
}

export const activeCues = derived([cues, activeTrackId, selectedCueId], ([$cues, $activeTrackId, $selectedCueId]) =>
  $cues
    .filter((cue) => cue.trackId === $activeTrackId)
    .sort((a, b) => a.start - b.start)
    .map((cue) => ({ ...cue, selected: cue.id === $selectedCueId }))
);

export const queueCues = derived([reviewQueue, cues], ([$reviewQueue, $cues]) =>
  $reviewQueue.map((id) => $cues.find((cue) => cue.id === id)).filter((cue): cue is Cue => Boolean(cue))
);

export const checkedOutCues = derived([checkedOut, cues], ([$checkedOut, $cues]) =>
  $checkedOut
    .map((slot) => ({ slot, cue: $cues.find((item) => item.id === slot.cueId) }))
    .filter((entry): entry is { slot: CheckoutSlot; cue: Cue } => Boolean(entry.cue))
);

export const deliveryOverview = derived([tracks, cues], ([$tracks, $cues]) =>
  $tracks.map((track) => ({ track, readiness: trackReadiness(track, $cues) }))
);

export const opinionsForSelected = derived([opinions, selectedCueId], ([$opinions, $selectedCueId]) =>
  $opinions.filter((opinion) => opinion.cueId === $selectedCueId)
);
