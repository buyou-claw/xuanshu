/** DSH-shaped management list, tokens inherited from the profile theme. */
export function installCangStyle() {
  if (typeof document === 'undefined' || document.getElementById('xuanshu-cang-style')) return;
  const style = document.createElement('style'); style.id = 'xuanshu-cang-style';
  style.textContent = `
.xs-cang{padding:var(--xs-space-6,24px);max-width:var(--xs-size-panel-content-max,1200px);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--fg)}
.xs-cang h1,.xs-cang h2{font-weight:600}.xs-cang h2{font-size:1.05rem}.xs-cang p{line-height:1.6}.xs-cang__boundary{position:sticky;top:0;z-index:1;background:var(--xs-constraint-noai-bg);color:var(--xs-constraint-noai-fg);padding:12px;border-radius:8px}
.xs-cang__toolbar,.xs-cang__actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:16px 0}.xs-cang button,.xs-cang__drawer button{font:inherit;padding:7px 12px;cursor:pointer;background:var(--bg-surface);color:inherit;border:1px solid var(--border);border-radius:6px}.xs-cang button:disabled,.xs-cang__drawer button:disabled{opacity:.5;cursor:not-allowed}
.xs-cang input,.xs-cang select,.xs-cang__drawer input{font:inherit;background:var(--bg-surface);color:inherit;border:1px solid var(--border);border-radius:6px;padding:7px;min-width:0}.xs-cang__card{border:1px solid var(--border);border-radius:10px;padding:16px;margin:12px 0;background:var(--bg-surface)}.xs-cang code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace)}.xs-cang__status{font-size:.8rem;font-weight:400}.xs-cang__more>summary{cursor:pointer}.xs-cang__more>div{display:flex;flex-wrap:wrap;gap:8px}.xs-cang__group>summary{padding:8px;cursor:pointer}.xs-cang footer{margin-top:24px;opacity:.75}.xs-cang__confirm{padding:16px;border:1px solid var(--border);border-radius:8px}
.xs-cang__overlay{position:fixed;inset:0;display:flex;justify-content:flex-end;background:rgb(0 0 0 / .35);pointer-events:auto;z-index:100}.xs-cang__drawer{width:min(560px,100%);overflow:auto;background:var(--bg-surface,#fff);color:var(--fg,#222);padding:24px;box-sizing:border-box;box-shadow:0 0 30px rgb(0 0 0 / .15)}.xs-cang__drawer form>label{display:block;margin:16px 0}.xs-cang__drawer form>label input{display:block;box-sizing:border-box;width:100%;margin-top:8px}.xs-cang__drawer fieldset label{display:block;margin:8px 0}.xs-cang__drawer fieldset input{margin-right:8px}
@media(min-width:1100px){.xs-cang__more>summary{display:none}.xs-cang__more:not([open])>div{display:flex}}
@media(max-width:700px){.xs-cang{padding:14px}.xs-cang__toolbar{align-items:stretch;flex-direction:column}.xs-cang__drawer{padding:16px}}`;
  document.head.appendChild(style);
}
