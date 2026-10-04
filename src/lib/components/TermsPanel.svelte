<script lang="ts">
  import {
    activeTrackId, applyPendingTerms, cues, insertLockedTerm, lockTerm,
    selectedCueId, terms, tracks, updateTermTarget
  } from "$lib/stores/subtitles";
  import type { GlossaryTerm } from "$lib/stores/subtitles";

  let drafts = $state<Record<string, string>>({});

  const activeLocale = $derived($tracks.find((track) => track.id === $activeTrackId)?.locale ?? "en");
  const localeTerms = $derived($terms.filter((term) => term.locale === activeLocale));
  const affectedCues = $derived($cues.filter((cue) => cue.trackId === $activeTrackId && cue.pendingTerms.length > 0));
  const lockedTerms = $derived(localeTerms.filter((term) => term.status === "已锁定"));

  function startEdit(term: GlossaryTerm) {
    drafts[term.id] = term.target;
    drafts = { ...drafts };
  }
  function commitEdit(term: GlossaryTerm) {
    updateTermTarget(term.id, drafts[term.id] ?? "");
    drafts = { ...drafts, [term.id]: "" };
  }
</script>

<div class="terms-grid">
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>术语库（{activeLocale.toUpperCase()} 轨道）</h2>
        <small>锁定时译文按当前译法写；译法变更后，用到该词的字幕退回待审，先前通过的版本继续冻结</small>
      </div>
    </div>
    <div class="term-list">
      {#each localeTerms as term (term.id)}
        <article class="term-card">
          <div class="term-main">
            <b>{term.source}</b>
            {#if drafts[term.id] !== undefined && drafts[term.id] !== ""}
              <input class="input" bind:value={drafts[term.id]} placeholder="新译法" />
              <div class="actions">
                <button class="btn btn-sm variant-filled-primary" onclick={() => commitEdit(term)}>发布译法变更</button>
                <button class="btn btn-sm" onclick={() => { drafts = { ...drafts, [term.id]: "" }; }}>取消</button>
              </div>
            {:else}
              <span class="target">{term.target}</span>
              {#if term.prevTarget}<small class="prev">原译法：{term.prevTarget}</small>{/if}
            {/if}
          </div>
          <div class="actions">
            {#if term.status === "建议"}
              <button class="btn btn-sm" onclick={() => lockTerm(term.id)}>锁定</button>
            {:else if drafts[term.id] === undefined || drafts[term.id] === ""}
              <button class="btn btn-sm" onclick={() => startEdit(term)}>变更译法</button>
            {/if}
            <span class="chip {term.status === "已锁定" ? "已通过" : "待审"}">{term.status}</span>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <div class="right-stack">
    <section class="panel">
      <div class="panel-head"><h2>译法变更影响的字幕</h2><span class="chip 待审">{affectedCues.length} 条待重新确认</span></div>
      {#if !affectedCues.length}
        <p class="muted">没有挂起的术语变更。</p>
      {/if}
      <div class="queue-list">
        {#each affectedCues as cue (cue.id)}
          <article class="queue-item">
            <div class="row">
              <b>{cue.translated}</b>
              <span class="chip {cue.status === "待审" ? "待审" : cue.status}">{cue.status}</span>
            </div>
            <p class="muted">{cue.source}</p>
            {#if cue.frozen}
              <p class="frozen-note">冻结的通过版本继续保留：{cue.frozen.translated}</p>
            {/if}
            <p class="term-note">{cue.pendingTerms.map((p) => `「${p.source}」${p.oldTarget} → ${p.newTarget}`).join("；")}</p>
            <div class="actions">
              <button class="btn btn-sm variant-filled-primary" onclick={() => applyPendingTerms(cue.id)}>按当前译法改稿</button>
              <button class="btn btn-sm" onclick={() => selectedCueId.set(cue.id)}>在时间轴打开</button>
            </div>
          </article>
        {/each}
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>快速插入锁定译法</h2></div>
      <p class="muted">对时间轴中选中的字幕，直接追加当前锁定译法。</p>
      <div class="actions">
        {#each lockedTerms as term (term.id)}
          <button class="btn btn-sm" onclick={() => insertLockedTerm($selectedCueId, term.id)}>
            {term.source} → {term.target}
          </button>
        {/each}
        {#if !lockedTerms.length}<span class="muted">该语言暂无锁定术语。</span>{/if}
      </div>
    </section>
  </div>
</div>
