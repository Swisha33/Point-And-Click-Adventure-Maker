// Counters plugin - browser part. Same behaviour as game.lua (LÖVE / Vita).
export default function (api) {
    // api.data is stored in save games and starts empty for every new game
    const vars = () => {
        const d = api.data;
        if (!d.vars) d.vars = Object.assign({}, api.settings.start || {});
        return d.vars;
    };
    const num = (v) => parseFloat(v) || 0;
    const fields = [{ key: 'key', label: 'counter name', type: 'text' }, { key: 'value', label: 'number', type: 'number' }];

    api.registerAction('addvar', { label: 'Counter: add', fields }, (act) => { vars()[act.key] = num(vars()[act.key]) + num(act.value); });
    api.registerAction('setvar', { label: 'Counter: set', fields }, (act) => { vars()[act.key] = num(act.value); });
    api.registerCondition('varmin', { label: 'counter is at least', fields }, (c) => num(vars()[c.key]) >= num(c.value));
    api.registerCondition('varless', { label: 'counter is less than', fields }, (c) => num(vars()[c.key]) < num(c.value));
    api.registerUIVar('var', (name) => num(vars()[name]));
    api.registerUIAction('addvar', { label: 'Counter: add', fields }, (a) => { vars()[a.key] = num(vars()[a.key]) + num(a.value); });
    api.on('gameStart', () => { vars(); });
}
