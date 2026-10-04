<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";
  import { setLocale } from "$lib/paraglide/runtime.js";
  import TimelinePanel from "$lib/components/TimelinePanel.svelte";
  import ReviewQueuePanel from "$lib/components/ReviewQueuePanel.svelte";
  import TermsPanel from "$lib/components/TermsPanel.svelte";
  import DeliveryPanel from "$lib/components/DeliveryPanel.svelte";
  import {
    activeTab, activeTrackId, computeReadiness, cues, delivery, notices,
    readiness, reviewer, tracks, type TabId
  } from "$lib/stores/subtitles";

  const tabs: { id: TabId; label: string }[] = [
    { id: "timeline", label: "时间轴编辑" },
    { id: "review", label: "审校队列" },
    { id: "terms", label: "术语库" },
    { id: "delivery", label: "交付准备" }
  ];

  const activeMetrics = $derived.by(() => {
    void $cues;
    return computeReadiness($activeTrackId);
  });
</script>

<svelte:head><title>多语言字幕时间轴协作</title></svelte:head>
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><b>SUBFLOW</b><span>字幕协作台</span></div>
    <nav>
      {#each tabs as tab}
        <button class:active={$activeTab === tab.id} onclick={() => activeTab.set(tab.id)}>{tab.label}</button>
      {/each}
    </nav>
    <div class="keyboard">
      <b>键盘操作</b>
      <span>J / K 选择字幕</span>
      <span>S 拆分 · M 合并</span>
      <span>⌘S 保存快照</span>
    </div>
  </aside>
  <main>
    <header>
      <div>
        <small>纪录片《潮汐线》 · 第 3 集</small>
        <h1>{m.title()}</h1>
        <p>多语种轨道、术语锁定、审校容量与按语言交付在同一时间轴协作。当前身份：{$reviewer}</p>
      </div>
      <div class="header-actions">
        <select value={$activeTrackId} onchange={(event) => activeTrackId.set(event.currentTarget.value)}>
          {#each $tracks as track}<option value={track.id}>{track.name}</option>{/each}
        </select>
        <button onclick={() => setLocale("en")}>EN</button>
        <button onclick={() => setLocale("zh")}>中文</button>
      </div>
    </header>

    <!-- 制作人视角：哪些语言现在能交出去 -->
    <section class="lang-board">
      {#each $tracks as track}
        {@const r = $readiness[track.id]}
        {@const item = $delivery[track.id]}
        <article class={`lang-card ${r.blockers.length ? "blocked" : "ready"}`}>
          <header>
            <b>{track.name}</b>
            <span class={`chip ${r.blockers.length ? "待审" : "已通过"}`}>{r.blockers.length ? "暂不可交付" : "可交付"}</span>
          </header>
          <p class="muted">{r.approved}/{r.total} 条已通过 · 待审 {r.pending} · 退回 {r.rejected} · 草稿 {r.draft}</p>
          {#if r.held || r.termReconfirm}
            <p class="muted">借出 {r.held}（超时 {r.stale}）· 术语重审 {r.termReconfirm}</p>
          {/if}
          {#if r.blockers.length}
            <ul class="blocker-list">{#each r.blockers as b}<li>{b}</li>{/each}</ul>
          {:else}
            <p class="ok-note">无审校 / 术语阻挡{track.id === "zh" ? "（原语轨道）" : ""}</p>
          {/if}
          {#if item && item.status !== "未尝试"}<p class="muted">交付状态：{item.status}</p>{/if}
        </article>
      {/each}
    </section>

    <section class="metrics">
      <article><span>当前轨道</span><b>{$tracks.find((track) => track.id === $activeTrackId)?.name}</b></article>
      <article><span>字幕条数</span><b>{activeMetrics.total}</b></article>
      <article><span>待审（含借出）</span><b>{activeMetrics.pending}</b></article>
      <article><span>已通过</span><b>{activeMetrics.approved}</b></article>
    </section>

    {#if $notices.length}
      <div class="notice-stack">
        {#each $notices as notice (notice.id)}
          <div class={`notice ${notice.kind}`}>{notice.text}</div>
        {/each}
      </div>
    {/if}

    {#if $activeTab === "timeline"}
      <TimelinePanel />
    {:else if $activeTab === "review"}
      <ReviewQueuePanel />
    {:else if $activeTab === "terms"}
      <TermsPanel />
    {:else}
      <DeliveryPanel />
    {/if}
  </main>
</div>
