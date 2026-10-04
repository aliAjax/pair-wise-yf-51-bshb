<script lang="ts">
  import { onMount } from "svelte";
  import { derived, get } from "svelte/store";
  import { createQuery } from "@tanstack/svelte-query";
  import { superForm } from "sveltekit-superforms";
  import { zod4 } from "sveltekit-superforms/adapters";
  import { z } from "zod";
  import {
    activeCues, activeTrackId, createSnapshot, cues, mergeNext, nudgeCue,
    resolveConflict, conflicts, restoreSnapshot, reviewEvents, selectedCueId,
    setCueStatus, snapshots, splitCue, tracks, updateCue
  } from "$lib/stores/subtitles";
  import type { Cue } from "$lib/stores/subtitles";

  const cueSchema = z.object({ source: z.string().min(2), translated: z.string().min(2), start: z.coerce.number().min(0), duration: z.coerce.number().min(0.5).max(30) });
  const defaults = { source: "", translated: "", start: 0, duration: 2.5 };
  const { form, errors, enhance } = superForm(defaults, {
    validators: zod4(cueSchema),
    onSubmit: async ({ formData }) => {
      const start = Number(formData.get("start") ?? 0);
      const item: Cue = {
        id: crypto.randomUUID(), trackId: $activeTrackId, start,
        end: start + Number(formData.get("duration") ?? 2.5),
        source: String(formData.get("source") ?? ""),
        translated: String(formData.get("translated") ?? ""),
        status: "翻译中", translator: "当前译者",
        heldBy: null, heldAt: null, opinions: [], pendingTerms: [],
        termDirty: false, frozen: null
      };
      cues.update((items) => [...items, item]);
      selectedCueId.set(item.id);
    }
  });

  const queryOptions = derived(activeTrackId, ($trackId) => ({ queryKey: ["cues", $trackId] as const, queryFn: async (): Promise<Cue[]> => get(activeCues) }));
  const query = createQuery(queryOptions);
  const selected = $derived($cues.find((cue) => cue.id === $selectedCueId));

  function formatTime(value: number) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    const tenths = Math.floor((value % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
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

<div class="editor-grid">
  <section class="panel timeline">
    <div class="panel-head">
      <div><h2>时间轴</h2><small>改动已通过字幕会立即撤回“已通过”并退回待审；所有修改保存在浏览器本地</small></div>
      <button class="btn variant-filled-primary" onclick={() => createSnapshot()}>保存快照</button>
    </div>
    {#if $query.isPending}<p>正在加载字幕轨道…</p>{:else}
      <div class="cue-list">
        {#each $activeCues as cue}
          <div role="button" tabindex="0" class:selected={cue.id === $selectedCueId} class={`cue ${cue.status}`} onclick={() => selectedCueId.set(cue.id)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") selectedCueId.set(cue.id); }}>
            <time>{formatTime(cue.start)}<small>{formatTime(cue.end)}</small></time>
            <div><b>{cue.source}</b><p>{cue.translated || "尚未填写译文"}</p></div>
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
        <label class="label"><span>原文字幕</span><input class="input" value={selected.source} oninput={(event) => updateCue(selected.id, { source: event.currentTarget.value })} /></label>
        <label class="label"><span>译文（锁定术语须按当前译法）</span><textarea class="textarea" value={selected.translated} oninput={(event) => updateCue(selected.id, { translated: event.currentTarget.value })}></textarea></label>
        <div class="time-fields">
          <label class="label"><span>开始秒</span><input class="input" type="number" step="0.1" value={selected.start} oninput={(event) => updateCue(selected.id, { start: Number(event.currentTarget.value) })} /></label>
          <label class="label"><span>结束秒</span><input class="input" type="number" step="0.1" value={selected.end} oninput={(event) => updateCue(selected.id, { end: Number(event.currentTarget.value) })} /></label>
        </div>

        {#if selected.frozen}
          <div class="frozen-box">
            <b>冻结的通过版本</b>
            <p>{selected.frozen.translated}</p>
            <small>{formatTime(selected.frozen.start)} – {formatTime(selected.frozen.end)} · {new Date(selected.frozen.time).toLocaleString("zh-CN")}</small>
          </div>
        {/if}

        {#if selected.pendingTerms.length}
          <p class="term-note">术语变更挂起：{selected.pendingTerms.map((p) => `${p.oldTarget} → ${p.newTarget}`).join("，")}，请到“术语库”面板按当前译法改稿后重新审校。</p>
        {/if}

        {#if selected.opinions.length}
          <div class="opinion-box">
            <b>退回意见（{selected.opinions.length} 份，全部留档）</b>
            {#each selected.opinions as op}<p><span class={`chip ${op.status === "已采纳" ? "已通过" : "退回"}`}>{op.status}</span> {op.reviewer}：{op.note}</p>{/each}
          </div>
        {/if}

        <div class="actions">
          <button class="btn" onclick={() => setCueStatus(selected.id, "待审")} disabled={selected.status === "已通过"}>提交审校</button>
          <button class="btn" onclick={() => splitCue(selected.id)}>拆分 (S)</button>
          <button class="btn" onclick={() => mergeNext(selected.id)}>合并下一条 (M)</button>
        </div>
      {:else}<p>请先选择一条字幕。</p>{/if}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>协作冲突</h2></div>
      {#each $conflicts as conflict}
        <article class="conflict">
          <b>{conflict.message}</b>
          <p>协作版本：{formatTime(conflict.remoteStart)}–{formatTime(conflict.remoteEnd)}</p>
          <div class="actions">
            <button class="btn btn-sm" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用本地")}>保留本机</button>
            <button class="btn btn-sm variant-filled-primary" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用协作版本")}>采用协作版本</button>
            <span class="chip">{conflict.status}</span>
          </div>
        </article>
      {/each}
      {#if !$conflicts.length}<p class="muted">暂无时间轴冲突。</p>{/if}
    </section>
  </aside>
</div>

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
  <section class="panel">
    <div class="panel-head"><h2>审校记录</h2></div>
    <div class="events">
      {#each $reviewEvents as item}
        <article>
          <b>{item.action}</b>
          <p>{item.detail}</p>
          <small>{item.actor} · {new Date(item.time).toLocaleTimeString("zh-CN")}</small>
        </article>
      {/each}
      {#if !$reviewEvents.length}<p>暂无审校操作。</p>{/if}
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>版本快照</h2></div>
    <div class="events">
      {#each $snapshots as item}
        <article>
          <b>{item.name}</b>
          <p>{item.cues.length} 条字幕 · {new Date(item.time).toLocaleString("zh-CN")}</p>
          <button class="btn btn-sm" onclick={() => restoreSnapshot(item.id)}>恢复</button>
        </article>
      {/each}
      {#if !$snapshots.length}<p>使用 ⌘S 或顶部按钮创建快照。</p>{/if}
    </div>
  </section>
</div>
