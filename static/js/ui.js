/* Shared UI helpers: a tiny DOM builder, presentational components, the action
   runner that wires a button to an API call, and toasts.

   Everything dynamic is built with textContent / createElement, never innerHTML,
   because item names and container IDs come straight from user-supplied CSVs. */

const SVG_NS = 'http://www.w3.org/2000/svg';
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const $ = (selector, root = document) => root.querySelector(selector);
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const currentView = () => document.body.dataset.view;


/* ── DOM builder ─────────────────────────────────────────────────────────── */

export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
}

export function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
}


/* ── Formatting ──────────────────────────────────────────────────────────── */

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const num = (n) => (n != null && Number.isFinite(+n) ? numberFormat.format(+n) : '—');
export const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

export function dateTime(iso) {
    const d = new Date(iso);
    return Number.isNaN(+d) ? String(iso ?? '—') : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fullDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(+d) ? String(iso ?? '—') : d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export const volume = (cm3) => (cm3 >= 1e6 ? `${num(cm3 / 1e6)} m³` : `${num(cm3)} cm³`);

/* Backend coordinates are { width, depth, height } start/end pairs, in cm. */
export function coords(position) {
    const s = position?.startCoordinates;
    const e = position?.endCoordinates;
    if (!s || !e) return h('span', { class: 'coords' }, '—');
    return h('span', { class: 'coords' },
        `W ${num(s.width)}–${num(e.width)} · D ${num(s.depth)}–${num(e.depth)} · H ${num(s.height)}–${num(e.height)}`);
}


/* ── Components ──────────────────────────────────────────────────────────── */

export const chip = (text, tone) => h('span', { class: 'chip', dataset: tone ? { tone } : null }, text);

export const stat = (label, value) =>
    h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));

const CALLOUT_ICON = { error: 'alert', warning: 'alert', success: 'check', info: 'info' };

export function callout(tone, title, body) {
    return h('div', { class: 'callout', dataset: { tone }, role: tone === 'error' ? 'alert' : null },
        icon(CALLOUT_ICON[tone]),
        h('div', { class: 'callout-body' },
            title && h('p', { class: 'callout-title' }, title),
            body && (typeof body === 'string' ? h('p', null, body) : body)));
}

export function emptyState(iconName, title, body) {
    return h('div', { class: 'empty' }, icon(iconName), h('p', { class: 'empty-title' }, title), body && h('p', null, body));
}

/* Table that renders in pages, so a plan with thousands of rows stays quick. */
export function table({ caption, columns, rows, pageSize = 100 }) {
    const tbody = h('tbody');
    const count = h('p', { class: 'footnote' });
    const more = h('button', { type: 'button', class: 'btn btn-plain' });
    let shown = 0;

    const renderMore = () => {
        for (const row of rows.slice(shown, shown + pageSize)) {
            tbody.append(h('tr', null, columns.map((c) =>
                h('td', { class: c.numeric ? 'numeric' : null }, c.render ? c.render(row) : row[c.key]))));
        }
        shown = Math.min(rows.length, shown + pageSize);
        const left = rows.length - shown;
        more.hidden = left <= 0;
        more.textContent = `Show ${num(Math.min(pageSize, left))} more`;
        count.textContent = `Showing ${num(shown)} of ${num(rows.length)}`;
    };
    more.addEventListener('click', renderMore);
    renderMore();

    return h('div', null,
        h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
            h('table', { class: 'table' },
                h('caption', { class: 'sr-only' }, caption),
                h('thead', null, h('tr', null, columns.map((c) =>
                    h('th', { scope: 'col', class: c.numeric ? 'numeric' : null }, c.label)))),
                tbody)),
        h('div', { class: 'table-foot' }, count, more));
}

/* Ordered "do this, then this" list used for retrieval steps. */
export function timeline(steps) {
    return h('ol', { class: 'timeline' }, steps.map((s, i) => {
        const final = s.action === 'retrieve';
        const name = s.itemName ?? s.ItemName ?? `Item ${s.itemId}`;
        return h('li', { class: final ? 'is-final' : null },
            h('span', { class: 'dot' }, final ? icon('check') : (s.step ?? i + 1)),
            h('div', null,
                h('p', { class: 'timeline-title' }, final ? `Take out ${name}` : `Set aside ${name}`),
                h('p', { class: 'timeline-sub' }, final
                    ? `Item #${s.itemId}`
                    : ['Put it back afterwards · #', s.itemId, ' · ', coords(s.position)])));
    }));
}

/* Raw JSON, tucked away. Serialised only when opened: payloads can be large. */
export function raw(data) {
    const pre = h('pre');
    const details = h('details', { class: 'raw' }, h('summary', null, 'Raw response'), pre);
    details.addEventListener('toggle', () => {
        if (details.open && !pre.textContent) pre.textContent = JSON.stringify(data, null, 2);
    });
    return details;
}


/* ── Motion ──────────────────────────────────────────────────────────────── */

/* New content eases in from slightly below; reduced motion gets a plain fade. */
export function reveal(node) {
    const frames = prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
    node.animate(frames, { duration: prefersReducedMotion() ? 160 : 380, easing: EASE_OUT });
}


/* ── Action runner ───────────────────────────────────────────────────────── */

const inflight = new WeakMap(); // output element → AbortController

function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
        if (button.getAttribute('aria-busy') === 'true') return;
        button._idle = [...button.childNodes];
        button.setAttribute('aria-busy', 'true');
        button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label ?? button.textContent);
    } else {
        button.removeAttribute('aria-busy');
        if (button._idle) button.replaceChildren(...button._idle);
        button._idle = null;
    }
}

export function mount(output, node, { scroll = true } = {}) {
    output.replaceChildren(node);
    output.dataset.state = 'ready';
    reveal(node);
    if (scroll) output.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* Runs `task`, shows progress on `button`, and renders the outcome into `output`.
   - mutates: true  → ignore repeat presses while in flight (the server already acted)
   - mutates: false → a newer request supersedes the older one, so a stale
                      response can never overwrite a fresh one.
   - If the person has navigated away by the time it finishes, a toast says so. */
export async function runAction({ view, button, busyLabel, output, mutates = false, scroll = true, task, render, success }) {
    if (mutates && button?.getAttribute('aria-busy') === 'true') return;

    inflight.get(output)?.abort();
    const controller = new AbortController();
    inflight.set(output, controller);

    setBusy(button, true, busyLabel);
    output.dataset.state = 'loading';

    try {
        const data = await task(controller.signal);
        if (controller.signal.aborted) return;
        mount(output, render(data), { scroll });
        const message = success?.(data);
        if (message && currentView() !== view) toast(message, { action: { label: 'View', href: `#/${view}` } });
    } catch (err) {
        if (err.name === 'AbortError') return;
        const message = err?.message || 'Something went wrong.';
        mount(output, callout('error', 'That didn’t work', message), { scroll });
        if (currentView() !== view) toast(message, { tone: 'error', action: { label: 'View', href: `#/${view}` } });
    } finally {
        if (inflight.get(output) === controller) {
            inflight.delete(output);
            setBusy(button, false);
            output.dataset.state = 'ready';
        }
    }
}


/* ── Toasts ──────────────────────────────────────────────────────────────── */

const MAX_TOASTS = 3;
const TOAST_MS = 5000;

export function toast(message, { tone = 'success', action } = {}) {
    const host = document.getElementById('toasts');
    while (host.children.length >= MAX_TOASTS) removeToast(host.firstElementChild);

    const el = h('div', { class: 'toast', role: tone === 'error' ? 'alert' : 'status', dataset: { tone } },
        icon(tone === 'error' ? 'alert' : 'check'),
        h('span', { class: 'toast-text' }, message),
        action && h('a', { class: 'btn btn-plain', href: action.href }, action.label),
        h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => dismissToast(el) }, icon('x')));
    host.append(el);

    // Enter from above; leave the same way (and a swipe up is the same path).
    el.animate(
        prefersReducedMotion()
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0, transform: 'translateY(-18px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, easing: EASE_OUT });

    const startTimer = (ms) => { el._timer = setTimeout(() => dismissToast(el), ms); };
    startTimer(TOAST_MS);
    el.addEventListener('pointerenter', () => clearTimeout(el._timer));
    el.addEventListener('pointerleave', () => { if (!el._dragging) { clearTimeout(el._timer); startTimer(2000); } });
    el.addEventListener('focusin', () => clearTimeout(el._timer));

    enableSwipeToDismiss(el, startTimer);
    return el;
}

/* Close a toast, optionally carrying on at the speed it was thrown (px/s, negative = up). */
function dismissToast(el, { from = 0, velocity = 0 } = {}) {
    if (el._leaving) return;
    el._leaving = true;
    clearTimeout(el._timer);

    if (prefersReducedMotion()) {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }).finished.then(() => removeToast(el));
        return;
    }
    const target = -(el.offsetHeight + 24);
    const speed = Math.abs(velocity);
    const duration = speed > 300 ? Math.min(260, Math.max(130, (Math.abs(target - from) / speed) * 1000)) : 240;
    el.animate(
        [{ transform: `translateY(${from}px)`, opacity: 1 }, { transform: `translateY(${target}px)`, opacity: 0 }],
        { duration, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }
    ).finished.then(() => removeToast(el), () => {});
}

/* Remove, then glide the remaining toasts into the gap instead of snapping. */
function removeToast(el) {
    if (!el?.isConnected) return;
    const siblings = [...el.parentElement.children].filter((c) => c !== el);
    const before = new Map(siblings.map((c) => [c, c.getBoundingClientRect().top]));
    clearTimeout(el._timer);
    el.remove();
    if (prefersReducedMotion()) return;
    for (const c of siblings) {
        const dy = before.get(c) - c.getBoundingClientRect().top;
        if (dy) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: EASE_OUT });
    }
}

/* Drag a toast up to dismiss it.
   - It follows the pointer 1:1 from wherever it currently is on screen (even mid-entrance).
   - Pulling down rubber-bands instead of stopping dead.
   - On release, velocity projects where the toast would coast to rest; if that is
     far enough up it leaves at the flick's speed, otherwise it settles back. */
function enableSwipeToDismiss(el, restartTimer) {
    const DECELERATION = 0.998;
    let pointerId = null;
    let startY = 0;
    let baseY = 0;
    let samples = [];

    const rubberBand = (distance, limit = 120, k = 0.55) => (distance * limit * k) / (limit + k * Math.abs(distance));
    const currentY = (e) => {
        const dy = e.clientY - startY;
        return baseY + (dy < 0 ? dy : rubberBand(dy));
    };

    el.addEventListener('pointerdown', (e) => {
        if (el._leaving || e.target.closest('a, button')) return;
        pointerId = e.pointerId;
        startY = e.clientY;
        baseY = new DOMMatrix(getComputedStyle(el).transform).m42; // start from what is on screen now
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transform = `translateY(${baseY}px)`;
        samples = [{ t: e.timeStamp, y: e.clientY }];
        el._dragging = true;
        clearTimeout(el._timer);
        el.setPointerCapture(pointerId);
    });

    el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pointerId) return;
        samples.push({ t: e.timeStamp, y: e.clientY });
        samples = samples.filter((s) => e.timeStamp - s.t <= 100);
        el.style.transform = `translateY(${currentY(e)}px)`;
    });

    const release = (e, cancelled) => {
        if (e.pointerId !== pointerId) return;
        pointerId = null;
        el._dragging = false;
        const y = currentY(e);
        // Only motion in the last 100ms counts: holding still before letting go means no fling.
        const recent = samples.filter((s) => e.timeStamp - s.t <= 100);
        const first = recent[0];
        const last = recent[recent.length - 1];
        const velocity = !cancelled && recent.length > 1 && last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
        const projected = y + (velocity / 1000) * (DECELERATION / (1 - DECELERATION));

        el.style.transform = '';
        if (projected < -40) {
            dismissToast(el, { from: y, velocity });
        } else {
            if (Math.abs(y) > 0.5) el.animate([{ transform: `translateY(${y}px)` }, { transform: 'none' }], { duration: 450, easing: EASE_OUT });
            restartTimer(2500);
        }
    };
    el.addEventListener('pointerup', (e) => release(e, false));
    el.addEventListener('pointercancel', (e) => release(e, true));
}
