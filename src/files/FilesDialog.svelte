<script lang="ts" module>
  export interface DialogButton {
    label: string;
    value: string;
    kind?: "primary" | "destructive";
  }
  export interface DialogRequest {
    title: string;
    message: string;
    buttons: DialogButton[];
    resolve: (value: string) => void;
  }
</script>

<script lang="ts">
  // A question in the Files window ("Save changes to …?"). Escape picks "cancel".
  import { onMount } from "svelte";

  let { request }: { request: DialogRequest } = $props();
  let box = $state<HTMLDivElement>();

  onMount(() => box?.querySelector<HTMLButtonElement>(".primary, button")?.focus());

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      request.resolve("cancel");
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" {onkeydown}>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="files-dialog-title" bind:this={box}>
    <h2 id="files-dialog-title">{request.title}</h2>
    <p>{request.message}</p>
    <div class="buttons">
      {#each request.buttons as b (b.value)}
        <button class="btn {b.kind ?? ''}" onclick={() => request.resolve(b.value)}>{b.label}</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.25);
  }
  .dialog {
    width: min(420px, calc(100% - 40px));
    padding: 20px 20px 16px;
    border-radius: var(--radius-lg);
    background: var(--bg-list);
    box-shadow: var(--shadow-pop);
    animation: pop 0.12s ease-out;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.97;
    }
  }
  h2 {
    margin: 0 0 6px;
    font-size: 15px;
  }
  p {
    margin: 0 0 16px;
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    font-weight: 500;
  }
  .btn:hover {
    background: var(--bg-active);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .btn.primary:hover {
    background: var(--accent-strong);
  }
  .btn.destructive {
    background: var(--danger);
    color: #fff;
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
