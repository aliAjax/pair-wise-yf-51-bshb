<script lang="ts">
  import {
    buildManifest, cues, delivery, failNextLocale, prepareDeliveries, tracks
  } from "$lib/stores/subtitles";
  import type { DeliveryItem } from "$lib/stores/subtitles";

  const statusCls: Record<DeliveryItem["status"], string> = {
    "已生成": "已通过",
    "失败": "退回",
    "被挡住": "待审",
    "未尝试": ""
  };

  function gateSummary(locale: string): { approved: number; total: number; pending: number; rejected: number; draft: number; stale: number; term: number } {
    const list = $cues.filter((cue) => cue.trackId === locale);
    return {
      approved: list.filter((cue) => cue.status === "已通过").length,
      total: list.length,
      pending: list.filter((cue) => cue.status === "待审").length,
      rejected: list.filter((cue) => cue.status === "退回").length,
      draft: list.filter((cue) => cue.status === "待译" || cue.status === "翻译中").length,
      stale: list.filter((cue) => cue.status === "待审" && !!cue.heldBy && cue.heldAt && Date.now() - new Date(cue.heldAt).getTime() > 10 * 60000).length,
      term: list.filter((cue) => cue.pendingTerms.length > 0).length
    };
  }

  function download(filename: string, content: string, type = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadSrt(locale: string) {
    const item = $delivery[locale];
    if (item?.content) download(`subtitles-${locale}.srt`, item.content);
  }
</script>

<section class="panel">
  <div class="panel-head">
    <div>
      <h2>按语言分别交付</h2>
      <small>每门语言独立准备：一门失败后已生成的先留着，重试只做剩下的；说明里写清已生成 / 被术语或审校挡住的语言</small>
    </div>
    <div class="actions">
      <select class="input" value={$failNextLocale} onchange={(e) => failNextLocale.set(e.currentTarget.value)}>
        <option value="">下次导出：正常</option>
        {#each $tracks.filter((track) => $delivery[track.id]?.status !== "已生成") as track}
          <option value={track.id}>模拟下一门失败：{track.name}</option>
        {/each}
      </select>
      <button class="btn variant-filled-primary" onclick={prepareDeliveries}>
        准备交付 / 重试剩余
      </button>
      <button class="btn" onclick={() => download("交付说明.txt", buildManifest())}>导出说明</button>
    </div>
  </div>
</section>

<div class="delivery-grid">
  {#each $tracks as track (track.id)}
    {@const item = $delivery[track.id]}
    {@const g = gateSummary(track.id)}
    <section class="panel delivery-card">
      <header class="row">
        <b>{track.name}</b>
        <span class={`chip ${statusCls[item.status]}`}>{item.status}</span>
      </header>
      <dl class="gate">
        <div><dt>总条数</dt><dd>{g.total}</dd></div>
        <div><dt>已通过</dt><dd class="ok">{g.approved}</dd></div>
        <div><dt>待审</dt><dd class="warn">{g.pending}</dd></div>
        <div><dt>术语重审</dt><dd class="warn">{g.term}</dd></div>
        <div><dt>退回</dt><dd class="err">{g.rejected}</dd></div>
        <div><dt>草稿</dt><dd class="muted">{g.draft}</dd></div>
        <div><dt>超时借出</dt><dd class="warn">{g.stale}</dd></div>
      </dl>
      {#if item.reason}
        <p class="blocked">被挡住：{item.reason}</p>
      {/if}
      {#if item.error}
        <p class="failed">失败原因：{item.error}（已尝试 {item.attempts} 次）</p>
      {/if}
      {#if item.status === "已生成"}
        <p class="muted">第 {item.attempts} 次尝试生成 · {item.cueCount} 条字幕{item.time ? ` · ${new Date(item.time).toLocaleString("zh-CN")}` : ""}</p>
        <button class="btn btn-sm variant-filled-primary" onclick={() => downloadSrt(track.id)}>下载 {track.locale}.srt</button>
      {/if}
    </section>
  {/each}
</div>

<section class="panel">
  <div class="panel-head"><h2>导出说明预览</h2></div>
  <pre class="manifest">{buildManifest()}</pre>
</section>
