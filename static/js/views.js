/* Behaviour for each section. Each `init*` function wires one view's forms to
   the API and decides how its results are presented. */

import { api } from './api.js';
import {
    $, h, icon, chip, stat, callout, emptyState, table, timeline, raw,
    coords, num, plural, dateTime, fullDate, volume, runAction, toast,
} from './ui.js';

/* main.js calls these when a view becomes active. */
export const onEnter = {};

export function initViews() {
    initStowage();
    initRetrieval();
    initWaste();
    initSimulation();
    initRecords();
}


/* ── Small form helpers ──────────────────────────────────────────────────── */

const WHOLE_NUMBER = /^\d+$/;

const pad = (n) => String(n).padStart(2, '0');
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(dateString, days) {
    const [y, m, d] = dateString.split('-').map(Number);
    return toDateInput(new Date(y, m - 1, d + days));
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return bytes < 1024 * 1024 ? `${num(bytes / 1024)} KB` : `${num(bytes / 1024 / 1024)} MB`;
}

/* Reports a problem on a field and clears it as soon as the person edits it. */
function invalid(input, message) {
    input.setCustomValidity(message);
    input.reportValidity();
    input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
}

/* A CSV chooser that also accepts drag-and-drop; the submit button waits for a file. */
function bindFilePicker(form) {
    const input = $('input[type="file"]', form);
    const row = $('.file-row', form);
    const name = $('.file-name', form);
    const hint = $('.file-hint', form);
    const submit = $('[type="submit"]', form);

    const sync = () => {
        const file = input.files[0];
        name.textContent = file ? file.name : 'Choose a CSV file';
        hint.textContent = file ? formatBytes(file.size) : 'or drop it here';
        row.classList.toggle('has-file', Boolean(file));
        submit.disabled = !file;
    };

    input.addEventListener('change', sync);
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('is-over'); });
    row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove('is-over'); });
    row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('is-over');
        const file = [...e.dataTransfer.files].find((f) => /\.csv$/i.test(f.name));
        if (!file) return toast('Only .csv files can be uploaded.', { tone: 'error' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        sync();
    });

    sync();
    return input;
}

/* Two-option segmented control; slides its thumb by setting --i. */
function bindSegmented(seg, onChange) {
    const radios = [...seg.querySelectorAll('input[type="radio"]')];
    const sync = () => seg.style.setProperty('--i', Math.max(0, radios.findIndex((r) => r.checked)));
    radios.forEach((r) => r.addEventListener('change', () => { sync(); onChange?.(r.value); }));
    sync();
}

function bindStepper(root) {
    const input = $('input', root);
    root.addEventListener('click', (e) => {
        const button = e.target.closest('[data-step]');
        if (!button) return;
        const next = (parseInt(input.value, 10) || 0) + Number(button.dataset.step);
        input.value = Math.min(Number(input.max), Math.max(Number(input.min), next));
        input.setCustomValidity('');
    });
}


/* ── Stowage ─────────────────────────────────────────────────────────────── */

function initStowage() {
    const markDone = (step) => { step.dataset.done = ''; };

    for (const cfg of [
        { form: '#containersForm', out: '#containersOut', step: '#step-containers', noun: 'container', call: api.importContainers, key: 'containersImported' },
        { form: '#itemsForm', out: '#itemsOut', step: '#step-items', noun: 'item', call: api.importItems, key: 'itemsImported' },
    ]) {
        const form = $(cfg.form);
        const step = $(cfg.step);
        const file = bindFilePicker(form);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!file.files[0]) return;
            runAction({
                view: 'stowage',
                button: $('[type="submit"]', form),
                busyLabel: 'Uploading…',
                output: $(cfg.out),
                mutates: true,
                task: (signal) => cfg.call(file.files[0], signal),
                render: (data) => { markDone(step); return importSummary(data, cfg.noun, data[cfg.key]); },
                success: (data) => `${plural(data[cfg.key], cfg.noun)} imported`,
            });
        });
    }

    $('#placementBtn').addEventListener('click', (e) => {
        runAction({
            view: 'stowage',
            button: e.currentTarget,
            busyLabel: 'Calculating…',
            output: $('#placementOut'),
            mutates: true,
            task: (signal) => api.placement(signal),
            render: (data) => {
                if (data.placements?.length) markDone($('#step-placement'));
                return placementResult(data);
            },
            success: (data) => `Placement ready: ${plural(data.placements?.length ?? 0, 'item')} stowed`,
        });
    });
}

function importSummary(data, noun, count) {
    const errors = data.errors ?? [];
    const parts = [];
    if (count > 0) parts.push(callout('success', `${plural(count, noun)} imported`));
    else if (!errors.length) parts.push(callout('info', `No new ${noun}s`, `Every ${noun} in this file is already loaded.`));

    if (errors.length) {
        parts.push(callout('warning', `${plural(errors.length, 'row')} skipped`, h('ul', { class: 'issue-list' },
            errors.slice(0, 20).map((e) => h('li', null, `Row ${e.row}: ${e.message}`)),
            errors.length > 20 && h('li', null, `…and ${errors.length - 20} more`))));
    }
    return h('div', { class: 'stack-sm' }, parts, raw(data));
}

function placementResult(data) {
    const rows = data.placements ?? [];
    if (!rows.length) {
        return callout('info', 'Nothing was placed', 'Upload containers and items first, then calculate again.');
    }
    const seconds = parseFloat(data.Time_Taken);
    return h('div', { class: 'stack' },
        h('div', { class: 'stat-grid' },
            stat('Items placed', num(rows.length)),
            stat('Containers used', num(new Set(rows.map((r) => r.containerId)).size)),
            stat('Solve time', Number.isFinite(seconds) ? `${seconds.toFixed(2)} s` : (data.Time_Taken ?? '—'))),
        table({
            caption: 'Placement plan',
            rows,
            columns: [
                { label: 'Item', render: (r) => [r.name, ' ', h('span', { class: 'muted' }, `#${r.itemId}`)] },
                { label: 'Container', render: (r) => chip(r.containerId) },
                { label: 'Position (cm)', render: (r) => coords(r.position) },
            ],
        }),
        raw(data));
}


/* ── Retrieval ───────────────────────────────────────────────────────────── */

function initRetrieval() {
    const searchForm = $('#searchForm');
    const query = $('#searchQuery');

    bindSegmented($('#searchType'), (type) => {
        query.placeholder = type === 'itemId' ? 'Item ID, e.g. 4821' : 'Exact item name';
        query.inputMode = type === 'itemId' ? 'numeric' : 'text';
        query.setCustomValidity('');
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const type = new FormData(searchForm).get('searchType');
        const text = query.value.trim();
        if (!text) return invalid(query, 'Enter an item to look for.');
        if (type === 'itemId' && !WHOLE_NUMBER.test(text)) return invalid(query, 'Item IDs are whole numbers, like 4821.');

        runAction({
            view: 'retrieval',
            button: $('[type="submit"]', searchForm),
            busyLabel: 'Searching…',
            output: $('#searchOut'),
            task: (signal) => api.search({ [type]: text }, signal),
            render: (data) => foundResult(data, text, type),
        });
    });

    const retrieveForm = $('#retrieveForm');
    const retrieveId = $('#retrieveItemId');
    retrieveForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = retrieveId.value.trim();
        if (!WHOLE_NUMBER.test(id)) return invalid(retrieveId, 'Item IDs are whole numbers, like 4821.');
        confirmRetrieval({ id, button: $('[type="submit"]', retrieveForm), output: $('#retrieveOut') });
    });
}

function confirmRetrieval({ id, button, output, onDone }) {
    return runAction({
        view: 'retrieval',
        button,
        busyLabel: 'Confirming…',
        output,
        mutates: true,
        task: (signal) => api.retrieve(id, signal),
        render: () => {
            onDone?.();
            return callout('success', `Item #${id} retrieved`, 'The use was counted and the retrieval logged.');
        },
        success: () => `Item #${id} retrieved`,
    });
}

function foundResult(data, query, type) {
    if (!data.found) {
        return emptyState('search', `No match for “${query}”`, type === 'itemName'
            ? 'Names must match exactly, including capitals. Try searching by ID instead.'
            : 'That ID isn’t in the current stowage plan. Has the placement been calculated?');
    }

    const item = data.item;
    const steps = data.retrievalSteps ?? [];
    const blockers = steps.filter((s) => s.action !== 'retrieve').length;

    const slot = h('div', { class: 'stack-sm' });
    const confirm = h('button', { type: 'button', class: 'btn btn-primary' }, icon('check'), 'Confirm retrieval');
    confirm.addEventListener('click', () =>
        confirmRetrieval({ id: item.itemId, button: confirm, output: slot, onDone: () => { confirm.hidden = true; } }));

    const fact = (label, value) => h('div', null, h('dt', null, label), h('dd', null, value));

    return h('article', { class: 'found' },
        h('header', { class: 'found-head' },
            h('div', null,
                h('h3', { class: 'found-name' }, item.name),
                h('p', { class: 'found-sub' }, `Item #${item.itemId}`)),
            blockers
                ? chip(`${plural(blockers, 'item')} in the way`, 'amber')
                : chip('Clear access', 'green')),
        h('dl', { class: 'facts' },
            fact('Container', chip(item.containerId)),
            fact('Zone', item.zone),
            fact('Position (cm)', coords(item.position))),
        h('div', { class: 'stack-sm' },
            h('h4', { class: 'section-label' }, 'How to get it out'),
            timeline(steps)),
        h('div', { class: 'actions' }, confirm),
        slot,
        raw(data));
}


/* ── Waste ───────────────────────────────────────────────────────────────── */

function initWaste() {
    $('#wasteScanBtn').addEventListener('click', (e) => {
        runAction({
            view: 'waste',
            button: e.currentTarget,
            busyLabel: 'Scanning…',
            output: $('#wasteOut'),
            task: (signal) => api.wasteIdentify(signal),
            render: wasteResult,
        });
    });

    const form = $('#returnForm');
    $('#undockingDate').value = toDateInput(new Date());

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = new FormData(form);
        runAction({
            view: 'waste',
            button: $('[type="submit"]', form),
            busyLabel: 'Planning…',
            output: $('#returnOut'),
            task: (signal) => api.returnPlan({
                undockingContainerId: String(data.get('undockingContainerId')).trim(),
                undockingDate: data.get('undockingDate'),
                maxWeight: parseFloat(data.get('maxWeight')),
            }, signal),
            render: returnPlanResult,
            success: () => 'Return plan ready',
        });
    });
}

const REASON_TONE = { 'Expired': 'red', 'Out of Uses': 'amber' };

function wasteResult(data) {
    const items = data.wasteItems ?? [];
    if (!items.length) return emptyState('check', 'Nothing to discard', 'No items are expired or used up right now.');

    const count = (reason) => items.filter((i) => i.reason === reason).length;
    return h('div', { class: 'stack' },
        h('div', { class: 'stat-grid' },
            stat('Items to discard', num(items.length)),
            stat('Expired', num(count('Expired'))),
            stat('Out of uses', num(count('Out of Uses')))),
        table({
            caption: 'Waste items',
            rows: items,
            columns: [
                { label: 'Item', render: (i) => [i.name, ' ', h('span', { class: 'muted' }, `#${i.itemId}`)] },
                { label: 'Container', render: (i) => chip(i.containerId) },
                { label: 'Reason', render: (i) => chip(i.reason ?? 'Unknown', REASON_TONE[i.reason]) },
                { label: 'Position (cm)', render: (i) => coords(i.position) },
            ],
        }),
        raw(data));
}

function returnPlanResult(data) {
    const plan = data.returnPlan ?? [];
    const manifest = data.returnManifest ?? {};
    const perItem = data.retrievalSteps ?? [];
    const returning = manifest.returnItems?.length ?? 0;

    if (!plan.length && !returning) {
        return callout('info', 'Nothing to return', 'There are no waste items to load onto that container.');
    }

    return h('div', { class: 'stack' },
        callout('success', `Plan ready for ${manifest.undockingContainerId}`,
            manifest.undockingDate ? `Undocking ${fullDate(`${manifest.undockingDate}T00:00:00`)}.` : null),
        h('div', { class: 'stat-grid' },
            stat('Items returning', num(returning)),
            stat('Total weight', `${num(manifest.totalWeight)} kg`),
            stat('Total volume', volume(manifest.totalVolume ?? 0))),
        table({
            caption: 'Return plan',
            rows: plan,
            columns: [
                { label: 'Step', numeric: true, render: (s) => s.step },
                { label: 'Item', render: (s) => [s.itemName, ' ', h('span', { class: 'muted' }, `#${s.itemId}`)] },
                { label: 'Move', render: (s) => h('span', { class: 'chip-list' }, chip(s.fromContainer), icon('arrow-right'), chip(s.toContainer)) },
            ],
        }),
        perItem.length > 0 && h('div', { class: 'stack-sm' },
            h('h4', { class: 'section-label' }, 'Retrieval steps'),
            perItem.map((steps) => {
                const last = steps[steps.length - 1] ?? {};
                const name = last.itemName ?? last.ItemName ?? `Item ${last.itemId}`;
                return h('details', { class: 'disclosure' },
                    h('summary', null, h('span', null, name, ' ', h('span', { class: 'muted' }, `#${last.itemId}`)), chip(plural(steps.length, 'step'))),
                    timeline(steps));
            })),
        raw(data));
}


/* ── Simulation ──────────────────────────────────────────────────────────── */

function initSimulation() {
    const form = $('#simForm');
    const days = $('#simDays');
    const items = $('#simItems');
    bindStepper($('.stepper', form));

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const count = parseInt(days.value, 10);
        if (!(count >= 1 && count <= 3650)) return invalid(days, 'Enter a number of days from 1 to 3650.');

        const parts = items.value.split(/[\s,]+/).filter(Boolean);
        if (!parts.every((p) => WHOLE_NUMBER.test(p))) return invalid(items, 'List item IDs as numbers separated by commas, like 12, 40, 97.');

        runAction({
            view: 'simulation',
            button: $('[type="submit"]', form),
            busyLabel: 'Simulating…',
            output: $('#simOut'),
            mutates: true,
            task: (signal) => api.simulate({ numOfDays: count, itemsToBeUsedPerDay: parts.map(Number) }, signal),
            render: (data) => simulationResult(data, count),
            success: (data) => `Advanced ${plural(count, 'day')} to ${new Date(data.newDate).toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
        });
    });
}

function simulationResult(data, days) {
    const used = data.changes?.itemsUsed ?? [];
    const expired = data.changes?.itemsExpired ?? [];

    const idCard = (title, ids, tone) => h('div', { class: 'id-card' },
        h('h4', { class: 'section-label' }, title),
        ids.length
            ? h('div', { class: 'chip-list' }, ids.map((id) => chip(`#${id}`, tone)))
            : h('p', { class: 'muted' }, 'None'));

    return h('div', { class: 'stack' },
        h('div', { class: 'sim-date' },
            h('p', { class: 'label' }, 'Mission date'),
            h('p', { class: 'sim-date-value' }, fullDate(data.newDate)),
            h('p', { class: 'footnote' }, `Advanced ${plural(days, 'day')}`)),
        h('div', { class: 'grid-2' },
            idCard('Used up', used, 'amber'),
            idCard('Expired', expired, 'red')),
        (used.length || expired.length) > 0 && h('div', null,
            h('a', { class: 'btn btn-secondary', href: '#/waste' }, 'Review in Waste', icon('arrow-right'))),
        raw(data));
}


/* ── Records ─────────────────────────────────────────────────────────────── */

const ACTION_TONE = { placement: 'green', retrieve: 'blue', simulation: 'amber' };

function initRecords() {
    const form = $('#logsForm');
    const output = $('#logsOut');

    const load = ({ button = $('[type="submit"]', form), scroll = true } = {}) => {
        const data = new FormData(form);
        const params = {};
        for (const key of ['startDate', 'itemId', 'userId', 'actionType']) {
            const value = String(data.get(key) ?? '').trim();
            if (value) params[key] = value;
        }
        // The server reads a bare end date as midnight at its start, so make "To" inclusive.
        const end = data.get('endDate');
        if (end) params.endDate = addDays(String(end), 1);

        return runAction({
            view: 'records', button, busyLabel: 'Loading…', output, scroll,
            task: (signal) => api.logs(params, signal),
            render: logsResult,
        });
    };

    form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
    $('#logsRefresh').addEventListener('click', (e) => load({ button: e.currentTarget }));
    onEnter.records = () => load({ button: null, scroll: false });
}

function logsResult(data) {
    const logs = [...(data.logs ?? [])].reverse();
    if (!logs.length) return emptyState('list', 'No matching activity', 'Try widening the dates or clearing a filter.');

    return h('div', { class: 'stack-sm' },
        table({
            caption: 'Activity log',
            rows: logs,
            columns: [
                { label: 'Time', render: (l) => h('span', { class: 'nowrap', title: l.timestamp }, dateTime(l.timestamp)) },
                { label: 'Action', render: (l) => chip(l.actionType, ACTION_TONE[l.actionType]) },
                { label: 'Subject', render: (l) => l.itemId ?? '—' },
                { label: 'User', render: (l) => l.userId ?? '—' },
                { label: 'Details', render: (l) => { const text = JSON.stringify(l.details ?? {}); return h('code', { class: 'clip', title: text }, text); } },
            ],
        }),
        raw(data));
}
