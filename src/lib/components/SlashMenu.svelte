<script lang="ts">
  // The menu shown after typing "/" in a note (see editor/slashCommands.ts).
  // It never takes focus: the editor keeps the cursor, and keys arrive through the
  // editor (arrows, Enter, Tab, Escape).
  import type { SlashCommand } from "../editor/slashCommands";

  interface Props {
    items: SlashCommand[];
    /** The highlighted item. */
    index: number;
    /** What was typed after "/". */
    query: string;
    x: number;
    y: number;
    /** Open upwards (not enough room below the cursor). */
    above: boolean;
    onpick: (item: SlashCommand) => void;
    onhover: (index: number) => void;
  }
  let { items, index, query, x, y, above, onpick, onhover }: Props = $props();

  let list = $state<HTMLDivElement>();

  // Groups only make sense in the full list; filtered results are ordered best first.
  const grouped = $derived(query.trim() === "");

  // Keep the highlighted item in view while moving with the arrow keys.
  $effect(() => {
    const id = items[index]?.id;
    list?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  });

  /** The title with the typed text marked, when the title contains it. */
  function parts(title: string): [string, string, string] {
    const q = query.trim().toLowerCase();
    const at = q ? title.toLowerCase().indexOf(q) : -1;
    return at < 0 ? [title, "", ""] : [title.slice(0, at), title.slice(at, at + q.length), title.slice(at + q.length)];
  }
</script>

<!-- mousedown is prevented so the editor keeps its cursor while an item is clicked -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="slash-menu"
  class:above
  style:left="{x}px"
  style:top="{y}px"
  onmousedown={(e) => e.preventDefault()}
>
  {#if items.length === 0}
    <div class="empty">No commands match “{query}”</div>
  {:else}
    <!-- The note keeps the focus and points at the highlighted item (aria-activedescendant). -->
    <div class="list" id="slash-menu-list" role="listbox" aria-label="Insert" bind:this={list}>
      {#each items as item, i (item.id)}
        {#if grouped && (i === 0 || items[i - 1].group !== item.group)}
          <div class="group" role="presentation">{item.group}</div>
        {/if}
        {@const [before, match, after] = parts(item.title)}
        <div
          class="item"
          class:active={i === index}
          role="option"
          id="slash-item-{item.id}"
          data-id={item.id}
          aria-selected={i === index}
          tabindex="-1"
          onmousemove={() => i !== index && onhover(i)}
          onclick={() => onpick(item)}
          onkeydown={() => {}}
        >
          <span class="icon"><item.icon size={18} strokeWidth={1.8} /></span>
          <span class="text">
            <span class="title">{before}<mark>{match}</mark>{after}</span>
            <span class="desc">{item.description}</span>
          </span>
          {#if item.hint}<kbd>{item.hint}</kbd>{/if}
        </div>
      {/each}
    </div>
  {/if}
  <div class="footer" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
    <span><kbd>↵</kbd> insert</span>
    <span><kbd>esc</kbd> close</span>
  </div>
</div>

<style>
  .slash-menu {
    position: absolute;
    z-index: 20;
    width: 320px;
    display: flex;
    flex-direction: column;
    background: var(--bg-list);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    animation: pop-down 0.12s ease-out;
    font-size: 13px;
  }
  .slash-menu.above {
    transform: translateY(-100%);
    flex-direction: column-reverse;
    animation-name: pop-up;
  }
  @keyframes pop-down {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }
  @keyframes pop-up {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .slash-menu {
      animation: none;
    }
  }

  .list {
    max-height: 316px;
    overflow-y: auto;
    padding: 6px;
    scroll-padding: 28px 0 6px;
  }
  .group {
    padding: 8px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
  }
  .group:first-child {
    padding-top: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--radius-md);
    cursor: default;
  }
  .item.active {
    background: var(--bg-active);
  }
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    background: var(--bg-editor);
    box-shadow: 0 0 0 1px var(--separator-strong);
    color: var(--text-secondary);
  }
  .item.active .icon {
    color: var(--accent-strong);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .title {
    font-weight: 500;
    color: var(--text);
  }
  .title mark {
    background: none;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }
  .desc {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  kbd {
    flex: none;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--bg-input);
    color: var(--text-secondary);
  }
  .empty {
    padding: 14px 14px 10px;
    color: var(--text-secondary);
  }
  .footer {
    display: flex;
    gap: 14px;
    padding: 7px 12px;
    border-top: 1px solid var(--separator);
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .above .footer {
    border-top: none;
    border-bottom: 1px solid var(--separator);
  }
  .footer kbd {
    padding: 0 4px;
    margin-right: 2px;
    font-size: 10px;
  }
</style>
