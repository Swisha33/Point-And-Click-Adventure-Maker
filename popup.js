// In-engine popups (replace alert/confirm/prompt). They live inside #gameContainer,
// so fullscreen stays on and they work with touch.
const root = () => document.getElementById('gameContainer') || document.body;

function build(message, { input = null, buttons = [] } = {}) {
    return new Promise((resolve) => {
        const back = document.createElement('div');
        back.className = 'popup-backdrop';
        const box = document.createElement('div');
        box.className = 'popup-box';
        const p = document.createElement('div');
        p.className = 'popup-text';
        p.textContent = message;
        box.appendChild(p);
        let inp = null;
        if (input !== null) {
            inp = document.createElement('input');
            inp.type = 'text'; inp.value = input; inp.className = 'popup-input';
            box.appendChild(inp);
        }
        const row = document.createElement('div');
        row.className = 'popup-buttons';
        const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(val); };
        buttons.forEach(b => {
            const btn = document.createElement('button');
            btn.textContent = b.label;
            if (b.danger) btn.classList.add('danger');
            btn.onclick = () => close(b.value === '__input' ? inp.value : b.value);
            row.appendChild(btn);
        });
        box.appendChild(row);
        back.appendChild(box);
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(buttons.find(b => b.cancel)?.value ?? null); }
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const ok = buttons.find(b => b.primary) || buttons[0]; close(ok.value === '__input' ? inp.value : ok.value); }
        };
        document.addEventListener('keydown', onKey, true);
        root().appendChild(back);
        (inp || row.querySelector('button'))?.focus();
    });
}

export const popup = {
    alert(msg) { return build(msg, { buttons: [{ label: 'OK', value: true, primary: true, cancel: true }] }); },
    confirm(msg, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
        return build(msg, { buttons: [{ label: cancel, value: false, cancel: true }, { label: ok, value: true, primary: true, danger }] });
    },
    // buttons: [{ label, value, danger, primary, cancel }]
    choice(msg, buttons) { return build(msg, { buttons }); },
    prompt(msg, def = '') {
        return build(msg, { input: def, buttons: [{ label: 'Cancel', value: null, cancel: true }, { label: 'OK', value: '__input', primary: true }] });
    },
    toast(msg, ms = 2200) {
        root().querySelectorAll('.popup-toast').forEach(o => o.remove());   // one notice at a time
        const t = document.createElement('div');
        t.className = 'popup-toast';
        t.textContent = msg;
        root().appendChild(t);
        setTimeout(() => t.classList.add('out'), ms);
        setTimeout(() => t.remove(), ms + 400);
    }
};
