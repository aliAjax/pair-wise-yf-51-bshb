<script lang="ts">
  import { onMount } from "svelte";
  import { derived, get } from "svelte/store";
  import { createQuery } from "@tanstack/svelte-query";
  import { superForm } from "sveltekit-superforms";
  import { zod4 } from "sveltekit-superforms/adapters";
  import { z } from "zod";
  import * as m from "$lib/paraglide/messages.js";
  import { setLocale } from "$lib/paraglide/runtime.js";
  import {
    activeCues,
    activeTrackId,
    conflicts,
    createSnapshot,
    cues,
    deliveryOverview,
    enqueueCue,
    checkedOutCues,
    lockTerm,
    mergeNext,
    nudgeCue,
    opinionsForSelected,
    prepareDelivery,
    releaseTimedOut,
    resolveConflict,
    restoreSnapshot,
    retryDelivery,
    exportReport as buildReport,
    reviewCue,
    reviewEvents,
    reviewer,
    checkedOut,
    queueCues,
    reviewQueue,
    returnToQueue,
    adoptOpinion,
    selectedCueId,
    setCueStatus,
    snapshots,
    splitCue,
    takeCues,
    terms,
    tracks,
    updateCue,
    updateTermTarget
  } from "$lib/stores/subtitles";
  import type { Cue } from "$lib/stores/subtitles";
  import { CHECKOUT_TIMEOUT_MS, REVIEW_CAPACITY, remainingMs } from "$lib/domain";

  const cueSchema = z.object({ source: z.string().min(2), translated: z.string().min(2), start: z.coerce.number().min(0), duration: z.coerce.number().min(0.5).max(30) });
  const defaults = { source: "", translated: "", start: 0, duration: 2.5 };
  const { form, errors, enhance } = superForm(defaults, {
    validators: zod4(cueSchema),
    onSubmit: async ({ formData }) => {
      const start = Number(formData.get("start") ?? 0);
      const item: Cue = { id: crypto.randomUUID(), trackId: $activeTrackId, start, end: start + Number(formData.get("duration") ?? 2.5), source: String(formData.get("source") ?? ""), translated: String(formData.get("translated") ?? ""), status: "翻译中", translator: "当前译者", reviewerNote: "", needsReconfirm: false, termStale: false, frozen: null };
      cues.update((items) => [...items, item]);
      selectedCueId.set(item.id);
    }
  });
  const queryOptions = derived(activeTrackId, ($trackId) => ({ queryKey: ["cues", $trackId] as const, queryFn: async (): Promise<Cue[]> => get(activeCues) }));
  const query = createQuery(queryOptions);
  const activeTrack = $derived($tracks.find((track) => track.id === $activeTrackId));
  const selected = $derived($cues.find((cue) => cue.id === $selectedCueId));
  const selectedSlot = $derived($checkedOut.find((slot) => slot.cueId === $selectedCueId));
  const reviewerHeld = $derived($checkedOut.filter((slot) => slot.reviewer === $reviewer).length);
  const deliverableCount = $derived($deliveryOverview.filter((entry) => entry.readiness.canDeliver).length);
  let reviewNote = $state("");

  // 审校队列勾选与提示
  let queueChecks = $state<Record<string, boolean>>({});
  let queueError = $state("");
  // 术语译法草稿
  let termDrafts = $state<Record<string, string>>({});
  $effect(() => {
    for (const term of $terms) {
      if (termDrafts[term.id] === undefined) termDrafts[term.id] = term.target;
    }
  });
  // 倒计时跳动 + 超时自动放回
  let now = $state(Date.now());
  let reportText = $state("");
  let showReport = $state(false);

  onMount(() => {
    releaseTimedOut();
    const tick = setInterval(() => {
      now = Date.now();
      releaseTimedOut();
    }, 1000);
    return () => clearInterval(tick);
  });

  function fmtTime(value: number) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    const tenths = Math.floor((value % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function fmtCountdown(ms: number) {
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function submitToQueue(id: string) {
    const result = enqueueCue(id);
    queueError = result.ok ? "" : (result.error ?? "");
  }

  function takeSelected() {
    const ids = Object.entries(queueChecks).filter(([, checked]) => checked).map(([id]) => id);
    if (!ids.length) {
      queueError = "请先勾选要带走的字幕";
      return;
    }
    const result = takeCues(ids);
    queueError = result.ok ? "" : (result.error ?? "");
    if (result.ok) queueChecks = {};
  }

  function saveTermTarget(id: string) {
    const next = (termDrafts[id] ?? "").trim();
    if (!next) return;
    updateTermTarget(id, next);
  }

  function openReport() {
    reportText = buildReport();
    showReport = true;
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  onMount(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "TEXTAREA" || (event.target as HTMLElement)?.tagName === "INPUT") return;
      const list = $activeCues;
      const index = list.findIndex((cue) => cue.id === $selectedCueId);
      if (event.key.toLowerCase() === "j" || event.key === "ArrowDown") selectedCueId.set(list[Math.min(list.length - 1, index + 1)]?.id ?? $selectedCueId);
      if (event.key.toLowerCase() === "k" || event.key === "ArrowUp") selectedCueId.set(list[Math.max(0, index - 1)]?.id ?? $selectedCueId);
      if (event.key.toLowerCase() === "s") splitCue($selectedCueId);
      if (event.key.toLowerCase() === "m") mergeNext($selectedCueId);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); createSnapshot(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
</script>

<svelte:head><title>多语言字幕时间轴协作</title></svelte:head>
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><b>SUBFLOW</b><span>字幕协作台</span></div>
    <nav>
      <button class="active" onclick={() => scrollTo("view-timeline")}>时间轴编辑</button>
      <button onclick={() => scrollTo("view-queue")}>审校队列</button>
      <button onclick={() => scrollTo("view-terms")}>术语库</button>
      <button onclick={() => scrollTo("view-delivery")}>交付总览</button>
      <button onclick={() => scrollTo("view-snapshots")}>版本快照</button>
    </nav>
    <div class="keyboard"><b>键盘操作</b><span>J / K 选择字幕</span><span>S 拆分 · M 合并</span><span>⌘S 保存快照</span></div>
  </aside>
  <main>
    <header>
      <div>
        <small>纪录片《潮汐线》 · 第 3 集</small>
        <h1>{m.title()}</h1>
        <p>多语种轨道、术语锁定与审校反馈在同一时间轴协作；制作人可在「交付总览」确认哪些语言能交出去。</p>
      </div>
      <div class="header-actions">
        <select value={$activeTrackId} onchange={(event) => activeTrackId.set(event.currentTarget.value)}>
          {#each $tracks as track}<option value={track.id}>{track.name}</option>{/each}
        </select>
        <button onclick={() => setLocale("en")}>EN</button>
        <button onclick={() => setLocale("zh")}>中文</button>
      </div>
    </header>

    <section class="metrics">
      <article><span>当前轨道</span><b>{activeTrack?.name}</b></article>
      <article><span>字幕条数</span><b>{$activeCues.length}</b></article>
      <article><span>审校队列</span><b>{$reviewQueue.length}/{REVIEW_CAPACITY}</b></article>
      <article><span>可交付语言</span><b>{deliverableCount}/{$tracks.length}</b></article>
    </section>

    <div class="editor-grid" id="view-timeline">
      <section class="panel timeline">
        <div class="panel-head">
          <div><h2>时间轴</h2><small>已通过的字幕改动后需重新确认；术语译法变动会自动退回待审</small></div>
          <button class="btn variant-filled-primary" onclick={() => createSnapshot()}>保存快照</button>
        </div>
        {#if $query.isPending}<p>正在加载字幕轨道…</p>{:else}
          <div class="cue-list">
            {#each $activeCues as cue}
              <div role="button" tabindex="0" class:selected={cue.id === $selectedCueId} class={`cue ${cue.status}`} onclick={() => selectedCueId.set(cue.id)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") selectedCueId.set(cue.id); }}>
                <time>{fmtTime(cue.start)}<small>{fmtTime(cue.end)}</small></time>
                <div>
                  <b>{cue.source}</b>
                  <p>{cue.translated || "尚未填写译文"}</p>
                  <div class="mini-chips">
                    {#if cue.termStale}<span class="chip term-stale">术语待确认</span>{/if}
                    {#if cue.needsReconfirm && !cue.termStale}<span class="chip reconfirm">改动待确认</span>{/if}
                    {#if $checkedOut.some((slot) => slot.cueId === cue.id)}<span class="chip checked-out">已带走</span>{/if}
                  </div>
                </div>
                <span class={`chip ${cue.status}`}>{cue.status}</span>
                <button class="btn btn-sm" onclick={(event) => { event.stopPropagation(); nudgeCue(cue.id, -0.2); }}>−0.2s</button>
                <button class="btn btn-sm" onclick={(event) => { event.stopPropagation(); nudgeCue(cue.id, 0.2); }}>+0.2s</button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <aside class="right-stack">
        <section class="panel">
          <div class="panel-head"><h2>字幕编辑</h2>{#if selected}<span class={`chip ${selected.status}`}>{selected.status}</span>{/if}</div>
          {#if selected}
            {#if selected.termStale}<p class="banner warn">术语译法已变动，本字幕需重新确认；先前通过的版本已冻结保留。</p>{:else if selected.needsReconfirm}<p class="banner warn">本字幕在通过后被改动，需重新确认，不能接着算通过。</p>{/if}
            {#if selectedSlot}<p class="banner info">已被 {selectedSlot.reviewer} 带走，剩余 {fmtCountdown(remainingMs(selectedSlot, now))} 未交回将自动放回队列（备注保留）。</p>{/if}
            <label class="label"><span>原文字幕</span><input class="input" value={selected.source} oninput={(event) => updateCue(selected.id, { source: event.currentTarget.value })} /></label>
            <label class="label"><span>译文</span><textarea class="textarea" value={selected.translated} oninput={(event) => updateCue(selected.id, { translated: event.currentTarget.value })}></textarea></label>
            <div class="time-fields">
              <label class="label"><span>开始秒</span><input class="input" type="number" step="0.1" value={selected.start} oninput={(event) => updateCue(selected.id, { start: Number(event.currentTarget.value) })} /></label>
              <label class="label"><span>结束秒</span><input class="input" type="number" step="0.1" value={selected.end} oninput={(event) => updateCue(selected.id, { end: Number(event.currentTarget.value) })} /></label>
            </div>
            <div class="actions">
              <button class="btn" onclick={() => submitToQueue(selected.id)}>提交审校</button>
              <button class="btn variant-filled-success" onclick={() => reviewCue(selected.id, true)}>审校通过</button>
              <button class="btn variant-filled-error" onclick={() => reviewCue(selected.id, false, reviewNote || "请核对术语和断句")}>退回修改</button>
              {#if selectedSlot}<button class="btn" onclick={() => returnToQueue(selected.id)}>放回队列</button>{/if}
            </div>
            <label class="label"><span>审校备注</span><input class="input" bind:value={reviewNote} placeholder="退回时填写具体原因" /></label>

            {#if selected.frozen}
              <div class="frozen">
                <b>已冻结版本（{selected.frozen.approvedBy} · {new Date(selected.frozen.approvedAt).toLocaleString("zh-CN")}）</b>
                <p>{selected.frozen.translated}</p>
              </div>
            {/if}

            <div class="opinions">
              <b>审校意见（{$opinionsForSelected.length}）</b>
              {#each $opinionsForSelected as opinion}
                <article class:adopted={opinion.adopted}>
                  <div class="opinion-head">
                    <span>{opinion.reviewer}</span>
                    <small>{new Date(opinion.createdAt).toLocaleString("zh-CN")}</small>
                    {#if opinion.adopted}<span class="chip 已通过">已采用</span>{/if}
                  </div>
                  <p>{opinion.note}</p>
                  <button class="btn btn-sm" disabled={opinion.adopted} onclick={() => adoptOpinion(selected.id, opinion.id)}>采用此意见</button>
                </article>
              {/each}
              {#if !$opinionsForSelected.length}<p class="empty">暂无退回意见。同一条字幕被两名审校退回时，两份意见都会留在这里。</p>{/if}
            </div>
          {:else}<p>请先选择一条字幕。</p>{/if}
        </section>

        <section class="panel" id="view-terms">
          <div class="panel-head"><h2>术语库</h2><small>锁定后译文按当前译法；改动译法会退回相关字幕</small></div>
          {#each $terms as term}
            <div class="term">
              <div class="term-row">
                <span><b>{term.source}</b> →</span>
                <input class="input term-input" bind:value={termDrafts[term.id]} />
                <button class="btn btn-sm" disabled={term.status === "已锁定" && termDrafts[term.id] === term.target} onclick={() => saveTermTarget(term.id)}>更新译法</button>
              </div>
              <div class="term-meta">
                <span class={`chip ${term.status}`}>{term.status}</span>
                <small>锁定基线：{term.lockedTarget || "—"} · {term.owner}</small>
              </div>
            </div>
          {/each}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>协作冲突</h2></div>
          {#each $conflicts as conflict}
            <article class="conflict">
              <b>{conflict.message}</b>
              <p>协作版本：{fmtTime(conflict.remoteStart)}–{fmtTime(conflict.remoteEnd)}</p>
              <div class="actions">
                <button class="btn btn-sm" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用本地")}>保留本机</button>
                <button class="btn btn-sm variant-filled-primary" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用协作版本")}>采用协作版本</button>
                <span class="chip">{conflict.status}</span>
              </div>
            </article>
          {/each}
        </section>
      </aside>
    </div>

    <section class="panel queue-panel" id="view-queue">
      <div class="panel-head">
        <div>
          <h2>审校队列</h2>
          <small>容量 {REVIEW_CAPACITY} 条 · 审校员一次最多带走 {REVIEW_CAPACITY} 条 · 超时 {Math.round(CHECKOUT_TIMEOUT_MS / 60000)} 分钟未交回自动放回，备注保留</small>
        </div>
        <button class="btn variant-filled-primary" onclick={takeSelected}>带走所选（{$reviewer}，名下 {reviewerHeld}）</button>
      </div>
      {#if queueError}<p class="banner error">{queueError}</p>{/if}
      <div class="queue-grid">
        <div>
          <h3>待取（{$queueCues.length}）</h3>
          {#each $queueCues as cue}
            <label class="queue-item">
              <input type="checkbox" bind:checked={queueChecks[cue.id]} />
              <div>
                <b>{cue.source}</b>
                <p>{cue.translated || "尚未填写译文"}</p>
                <small>{cue.translator} · 轨道 {cue.trackId}</small>
              </div>
            </label>
          {/each}
          {#if !$queueCues.length}<p class="empty">队列为空。在字幕编辑里点「提交审校」加入；超过 {REVIEW_CAPACITY} 条会拒绝入队。</p>{/if}
        </div>
        <div>
          <h3>已带走（{$checkedOutCues.length}）</h3>
          {#each $checkedOutCues as entry}
            <div class="queue-item held">
              <div>
                <b>{entry.cue.source}</b>
                <p>{entry.cue.translated || "尚未填写译文"}</p>
                <small>{entry.slot.reviewer} 带走 · 剩余 {fmtCountdown(remainingMs(entry.slot, now))}</small>
              </div>
              <button class="btn btn-sm" onclick={() => returnToQueue(entry.slot.cueId)}>放回队列</button>
            </div>
          {/each}
          {#if !$checkedOutCues.length}<p class="empty">暂无被带走的字幕。</p>{/if}
        </div>
      </div>
    </section>

    <section class="panel delivery-panel" id="view-delivery">
      <div class="panel-head">
        <div>
          <h2>交付总览</h2>
          <small>按语言分别准备；已生成的先留着，重试只做剩下的；导出说明写清哪几门已生成、哪几门被术语或审校挡住</small>
        </div>
        <div class="actions">
          <button class="btn" onclick={openReport}>导出说明</button>
          <button class="btn variant-filled-primary" onclick={() => { retryDelivery(); }}>重试剩余</button>
        </div>
      </div>
      <div class="delivery-grid">
        {#each $deliveryOverview as entry}
          <article class={`delivery-card ${entry.track.delivery}`}>
            <div class="delivery-top">
              <b>{entry.track.name}</b>
              <span class={`chip delivery ${entry.track.delivery}`}>{entry.track.delivery}</span>
            </div>
            <small>{entry.track.locale} · {entry.readiness.canDeliver ? "可交付" : `被 ${entry.readiness.blockedBy.join("、") || "—"} 挡住`}</small>
            <ul class="reasons">
              {#each entry.readiness.reasons as reason}<li>{reason}</li>{/each}
              {#if !entry.readiness.reasons.length}<li>全部字幕已通过，无术语冲突。</li>{/if}
            </ul>
            <div class="actions">
              <button class="btn btn-sm" disabled={entry.track.delivery === "已生成"} onclick={() => prepareDelivery(entry.track.locale)}>
                {entry.track.delivery === "已生成" ? "已生成" : "准备交付"}
              </button>
              {#if entry.track.delivery === "已生成"}<small>于 {new Date(entry.track.deliveredAt).toLocaleString("zh-CN")} 生成</small>{/if}
            </div>
          </article>
        {/each}
      </div>
      {#if showReport}
        <pre class="report">{reportText}</pre>
      {/if}
    </section>

    <div class="bottom-grid">
      <section class="panel">
        <div class="panel-head"><h2>新增字幕</h2></div>
        <form class="cue-form" method="POST" use:enhance>
          <label class="label"><span>原文</span><input class="input" name="source" bind:value={$form.source} /><small>{$errors.source?.[0]}</small></label>
          <label class="label"><span>译文</span><input class="input" name="translated" bind:value={$form.translated} /><small>{$errors.translated?.[0]}</small></label>
          <label class="label"><span>开始秒</span><input class="input" name="start" type="number" step="0.1" bind:value={$form.start} /></label>
          <label class="label"><span>持续秒</span><input class="input" name="duration" type="number" step="0.1" bind:value={$form.duration} /></label>
          <button class="btn variant-filled-primary" type="submit">新增到当前轨道</button>
        </form>
      </section>
      <section class="panel" id="view-snapshots">
        <div class="panel-head"><h2>版本快照</h2></div>
        <div class="events">
          {#each $snapshots as item}
            <article><b>{item.name}</b><p>{item.cues.length} 条字幕 · {new Date(item.time).toLocaleString("zh-CN")}</p><button class="btn btn-sm" onclick={() => restoreSnapshot(item.id)}>恢复</button></article>
          {/each}
          {#if !$snapshots.length}<p>使用 ⌘S 或顶部按钮创建快照。</p>{/if}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>审校记录</h2></div>
        <div class="events">
          {#each $reviewEvents as item}
            <article><b>{item.action}</b><p>{item.detail}</p><small>{item.actor} · {new Date(item.time).toLocaleTimeString("zh-CN")}</small></article>
          {/each}
          {#if !$reviewEvents.length}<p>暂无审校操作。</p>{/if}
        </div>
      </section>
    </div>
  </main>
</div>
