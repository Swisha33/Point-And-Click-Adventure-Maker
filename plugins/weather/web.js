// Weather plugin - browser part: rain / snow particles drawn over the level.
export default function (api) {
    const eng = api.engine;
    let drops = [];
    let preview = null;      // editor preview: forces a mode
    const mode = () => {
        if (preview) return preview;
        const d = api.data;
        if (d.override && d.override[eng.scene]) return d.override[eng.scene];
        return (api.settings.levels || {})[eng.scene] || 'none';
    };
    const spawn = (m, top) => ({
        x: Math.random() * 1000 - 20, y: top ? -10 - Math.random() * 40 : Math.random() * 540,
        v: m === 'snow' ? 0.8 + Math.random() * 1.2 : 9 + Math.random() * 5, s: Math.random()
    });

    api.registerAction('weather', {
        label: 'Weather',
        fields: [{ key: 'key', label: 'rain / snow / none', type: 'text' }, { key: 'value', label: 'level (empty = current level)', type: 'text' }]
    }, (act) => {
        const d = api.data; d.override = d.override || {};
        d.override[act.value || eng.scene] = act.key || 'none';
    });
    api.on('sceneEnter', () => { drops = []; });
    api.on('drawWorld', (ctx) => {
        const m = mode(); if (m !== 'rain' && m !== 'snow') return;
        const n = api.settings.amount || 140;
        while (drops.length < n) drops.push(spawn(m, false));
        ctx.save();
        if (m === 'rain') { ctx.strokeStyle = 'rgba(200,215,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); }
        else ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < drops.length; i++) {
            const p = drops[i];
            p.y += p.v; p.x += m === 'rain' ? -2 : Math.sin((p.y + i * 30) / 40) * 0.6;
            if (p.y > 545) drops[i] = spawn(m, true);
            if (m === 'rain') { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 3, p.y + 12); }
            else { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + p.s * 2, 0, Math.PI * 2); ctx.fill(); }
        }
        if (m === 'rain') ctx.stroke();
        ctx.restore();
    });

    // editor: panel to set the weather of the current level + a command for quick buttons
    api.editor.addPanel('Weather (plugin)', (box) => {
        const lv = api.settings.levels || (api.settings.levels = {});
        const row = document.createElement('div');
        ['none', 'rain', 'snow'].forEach(m => {
            const b = document.createElement('button');
            b.textContent = (lv[eng.scene] || 'none') === m ? `✓ ${m}` : m;
            b.onclick = () => { if (m === 'none') delete lv[eng.scene]; else lv[eng.scene] = m; drops = []; eng.updateUI(); };
            row.appendChild(b);
        });
        const lab = document.createElement('label'); lab.textContent = `Weather in "${eng.scene}" (remember SAVE CONFIG):`;
        box.append(lab, row);
    });
    api.editor.addCommand('weatherPreview', 'Weather preview (rain → snow → off)', () => {
        preview = preview === null ? 'rain' : preview === 'rain' ? 'snow' : null; drops = [];
        api.toast('Weather preview: ' + (preview || 'off'));
    });
}
