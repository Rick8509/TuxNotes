<script lang="ts">
  // Status bar → language: a searchable list to colour the file as another language.
  import { onMount, tick } from "svelte";
  import { Check } from "@lucide/svelte";
  import { LANGUAGE_NAMES } from "./languages";

  interface Props {
    current: string;
    onpick: (language: string) => void;
    onclose: () => void;
  }
  let { current, onpick, onclose }: Props = $props();

  let query = $state("");
  let index = $state(0);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();

  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGE_NAMES;
    const starts = LANGUAGE_NAMES.filter((n) => n.toLowerCase().startsWith(q));
    const contains = LANGUAGE_NAMES.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
    return [...starts, ...contains];
  });

  // Start on the current language.
  onMount(async () => {
    index = Math.max(0, LANGUAGE_NAMES.indexOf(current));
    await tick();
    input?.focus();
    list?.querySelector(".active")?.scrollIntoView({ block: "center" });
  });

  $effect(() => {
    void matches;
    list?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length) index = (index + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[index]) onpick(matches[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div class="picker" role="dialog" aria-label="Language">
  <input
    bind:this={input}
    bind:value={query}
    oninput={() => (index = 0)}
    {onkeydown}
    placeholder="Search languages"
    aria-label="Search languages"
    spellcheck="false"
  />
  <div class="list" role="listbox" aria-label="Languages" bind:this={list}>
    {#each matches as name, i (name)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="item"
        class:active={i === index}
        role="option"
        aria-selected={i === index}
        tabindex="-1"
        onmousemove={() => (index = i)}
        onclick={() => onpick(name)}
      >
        <span>{name}</span>
        {#if name === current}<Check size={14} />{/if}
      </div>
    {:else}
      <div class="none">No language matches “{query}”</div>
    {/each}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
  .picker {
    position: absolute;
    right: 10px;
    bottom: 32px;
    z-index: 51;
    width: 260px;
    padding: 6px;
    background: var(--bg-list);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    animation: pop 0.12s ease-out;
  }
  @keyframes pop {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }
  input {
    width: 100%;
    padding: 6px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    color: var(--text);
    font: inherit;
    outline: none;
  }
  .list {
    max-height: 300px;
    overflow-y: auto;
    margin-top: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    cursor: default;
  }
  .item.active {
    background: var(--bg-active);
  }
  .none {
    padding: 8px 9px;
    color: var(--text-secondary);
    font-size: 13px;
  }
</style>
