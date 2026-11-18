// agent-entry.js — how the development-only "Add model" agent is opened from the simulator, the DMX editor and the
// stage editor:  Ctrl (or ⌘) + double-click on the WINCODE logo area,  or  Ctrl + Alt + M.
//  (Ctrl + Shift + A and similar are taken by the browser itself.)
//  Whether the agent exists is asked once at start, so the window opens directly inside the click (a window opened
//  after waiting for the server can be stopped by the pop-up blocker). When it cannot open, a short message says why.
//  In the static web build there is no agent: the shortcut explains that instead of doing nothing.
let enabled = null;                 // null = still asking the server

function toast(text) {
  let el = document.getElementById('wmhToast');
  if (!el) {
    el = document.createElement('div'); el.id = 'wmhToast';
    el.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:100;max-width:560px;padding:10px 14px;border-radius:8px;' +
      'background:#1d232a;color:#e8ecf0;border:1px solid #f0923a;box-shadow:0 8px 24px rgba(0,0,0,.6);font:13px/1.45 "Segoe UI","Malgun Gothic",sans-serif;text-align:center';
    document.body.append(el);
  }
  el.textContent = text; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 6000);
}

function open() {
  if (window.WMH_STATIC) return toast('The Add-model agent is a development tool and is not part of the web version. Run the project locally (npm start) and use it at http://127.0.0.1:7740.');
  if (enabled === false) return toast('The Add-model agent is switched off: this server runs in distribution mode, or it could not be reached. Start it with "npm start".');
  const w = window.open('agent.html', 'wmh-agent', 'width=1000,height=860');
  if (!w) toast('The browser blocked the new window. Allow pop-ups for this page, or open agent.html in a new tab.');
}

export function installAgentEntry() {
  if (!window.WMH_STATIC) fetch('api/agent/info', { cache: 'no-store' }).then(r => r.json()).then(j => { enabled = !!j.enabled; }).catch(() => { enabled = false; });
  const brand = document.querySelector('.brand');
  if (brand) {
    brand.style.userSelect = 'none';                                           // a double-click must not select the logo text
    if (!window.WMH_STATIC) brand.title = (brand.title ? brand.title + ' · ' : '') + 'Ctrl + double-click (or Ctrl + Alt + M): Add-model agent';   // not advertised in the web version
    brand.addEventListener('dblclick', e => {
      if (!(e.ctrlKey || e.metaKey) || e.target.closest('select, input, button, a')) return;
      e.preventDefault(); open();
    });
    brand.addEventListener('mousedown', e => { if (e.detail > 1 && (e.ctrlKey || e.metaKey)) e.preventDefault(); });   // no text selection flash
  }
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyM') { e.preventDefault(); open(); } });
}
