<script lang="ts">
  import {
    adoptOpinion, approveAllHeld, cues, MAX_HELD_PER_REVIEWER, myHeldCues,
    pushNotice, queueCues, reclaimStaleHolds, releaseHeld, rejectedCues,
    reviewCue, reviewer, reviewers, setCueStatus, takeForReview, takeUpToCapacity,
    HOLD_TIMEOUT_MS, isStale
  } from "$lib/stores/subtitles";
  import type { Cue } from "$lib/stores/subtitles";

  let note = $state("");
  let activeCueId = $state<string | null>(null);

  const activeCue = $derived($cues.find((cue) => cue.id === activeCueId) ?? null);
  const heldCount = $derived($myHeldCues.length);

  function fmtHeld(iso: string | null): string {
    if (!iso) return "";
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return mins < 1 ? "不足 1 分钟" : `${mins} 分钟`;
  }

  function staleCls(cue: Cue) {
    return cue.status === "待审" && isStale(cue) ? "stale" : "";
  }

  function doApprove(cue: Cue) {
    reviewCue(cue.id, true);
  }
  function doReject(cue: Cue) {
    reviewCue(cue.id, false, note);
    note = "";
  }
</script>

<section class="panel">
  <div class="panel-head">
    <div>
      <h2>审校队列</h2>
      <small>一次最多带走 {MAX_HELD_PER_REVIEWER} 条；超过 {HOLD_TIMEOUT_MS / 60000} 分钟未交回自动放回队列，备注保留</small>
    </div>
    <div class="actions">
      <select class="input" value={$reviewer} onchange={(e) => reviewer.set(e.currentTarget.value)}>
        {#each reviewers as name}<option value={name}>{name}</option>{/each}
      </select>
      <button class="btn variant-filled-primary" onclick={takeUpToCapacity}>认领到上限</button>
      <button class="btn" onclick={reclaimStaleHolds}>收回超时字幕</button>
    </div>
  </div>

  <div class="queue-gauge">
    <span>{$reviewer} 的在手量：<b class={heldCount >= MAX_HELD_PER_REVIEWER ? "over" : ""}>{heldCount} / {MAX_HELD_PER_REVIEWER}</b></span>
    <div class="gauge"><i style={`width:${Math.min(100, (heldCount / MAX_HELD_PER_REVIEWER) * 100)}%`}></i></div>
    <button class="btn btn-sm variant-filled-success" disabled={!heldCount} onclick={approveAllHeld}>全部通过（{heldCount}）</button>
  </div>
</section>

<div class="queue-grid">
  <section class="panel">
    <div class="panel-head"><h2>我带走的字幕</h2></div>
    {#if !$myHeldCues.length}
      <p class="muted">你名下没有字幕，可从下方待认领队列带走。</p>
    {/if}
    <div class="queue-list">
      {#each $myHeldCues as cue (cue.id)}
        <article class={`queue-item {staleCls(cue)} ${activeCueId === cue.id ? "open" : ""}`}>
          <div class="row" role="button" tabindex="0" onclick={() => (activeCueId = activeCueId === cue.id ? null : cue.id)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activeCueId = activeCueId === cue.id ? null : cue.id; } }}>
            <b>{cue.translated || "（无译文）"}</b>
            <span class="chip 待审">{isStale(cue) ? "超时" : "待审"} · 借走 {fmtHeld(cue.heldAt)}</span>
          </div>
          <p class="muted">{cue.source}</p>
          {#if cue.frozen}
            <p class="frozen-note">先前通过版本已冻结保留：{cue.frozen.translated}</p>
          {/if}
          {#if cue.pendingTerms.length}
            <p class="term-note">术语变更待确认：{cue.pendingTerms.map((p) => `${p.oldTarget} → ${p.newTarget}`).join("，")}</p>
          {/if}
          {#if activeCueId === cue.id}
            <label class="label"><span>退回备注（两名审校员可各留一份）</span><input class="input" bind:value={note} placeholder="例如：术语与当前锁定译法不一致" /></label>
            <div class="actions">
              <button class="btn btn-sm variant-filled-success" disabled={!!cue.pendingTerms.length} onclick={() => doApprove(cue)}>审校通过</button>
              <button class="btn btn-sm variant-filled-error" onclick={() => doReject(cue)}>退回修改</button>
              <button class="btn btn-sm" onclick={() => releaseHeld(cue.id)}>放回队列</button>
            </div>
            {#if cue.pendingTerms.length}
              <small class="term-note">术语译法已更新，须先在术语库按当前译法改稿后才能通过。</small>
            {/if}
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>待认领队列</h2><span class="chip">{$queueCues.length} 条在队</span></div>
    {#if !$queueCues.length}
      <p class="muted">队列已空；超时字幕会由“收回超时字幕”放回此处。</p>
    {/if}
    <div class="queue-list">
      {#each $queueCues as cue (cue.id)}
        <article class={`queue-item ${activeCueId === cue.id ? "open" : ""}`}>
          <div class="row" role="button" tabindex="0" onclick={() => (activeCueId = activeCueId === cue.id ? null : cue.id)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activeCueId = activeCueId === cue.id ? null : cue.id; } }}>
            <b>{cue.translated || "（无译文）"}</b>
            <span class="chip 待审">待审</span>
          </div>
          <p class="muted">{cue.source}</p>
          {#if cue.frozen}
            <p class="frozen-note">含冻结的通过版本，本次为重新确认。</p>
          {/if}
          {#if cue.pendingTerms.length}
            <p class="term-note">待确认术语：{cue.pendingTerms.map((p) => `「${p.source}」${p.oldTarget} → ${p.newTarget}`).join("；")}</p>
          {/if}
          {#if activeCueId === cue.id}
            <div class="actions">
              <button class="btn btn-sm variant-filled-primary" onclick={() => { if (takeForReview(cue.id)) activeCueId = cue.id; }}>带走审校</button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </section>
</div>

<section class="panel">
  <div class="panel-head">
    <div><h2>退回意见（留档）</h2><small>同一条字幕被两名审校员退回时保留两份；采纳一份后另一份仍可查看</small></div>
  </div>
  <div class="opinion-grid">
    {#each $rejectedCues as cue (cue.id)}
      <article class="reject-card">
        <header>
          <b>{cue.source}</b>
          <span class="chip 退回">退回 · {cue.opinions.length} 份意见</span>
        </header>
        <p class="current">当前译文：{cue.translated}</p>
        <div class="opinions">
          {#each cue.opinions as op (op.id)}
            <div class={`opinion ${op.status === "已采纳" ? "adopted" : ""}`}>
              <div class="row">
                <b>{op.reviewer}</b>
                <span class="chip {op.status === "已采纳" ? "已通过" : "退回"}">{op.status}</span>
              </div>
              <p>{op.note}</p>
              <small>{new Date(op.time).toLocaleString("zh-CN")}</small>
              {#if op.status === "未采纳"}
                <button class="btn btn-sm" onclick={() => adoptOpinion(cue.id, op.id)}>采纳这份意见</button>
              {/if}
            </div>
          {/each}
        </div>
        <div class="actions">
          <button class="btn btn-sm variant-filled-primary" onclick={() => { setCueStatus(cue.id, "待审"); pushNotice("已按意见修改并重新提交，历史意见全部保留", "success"); }}>改好后重新提交审校</button>
        </div>
      </article>
    {/each}
    {#if !$rejectedCues.length}<p class="muted">当前没有被退回的字幕。</p>{/if}
  </div>
</section>
