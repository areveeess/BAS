/* App shell: hash routing between views, the condensing top bar, and start-up. */

import { initViews, onEnter } from './views.js';
import { EASE_OUT, prefersReducedMotion } from './ui.js';

const VIEWS = ['stowage', 'retrieval', 'waste', 'simulation', 'records'];
const DEFAULT_VIEW = VIEWS[0];

const topbar = document.getElementById('topbar');
const topbarTitle = document.getElementById('topbarTitle');
const links = [...document.querySelectorAll('[data-nav]')];

let current = null;
let titleObserver = null;

function viewFromHash() {
    const match = location.hash.match(/^#\/(\w+)/);
    return match && VIEWS.includes(match[1]) ? match[1] : null;
}

/* The nav lists views top to bottom, so content arrives from the direction you
   moved: choosing a later section rises up into place, an earlier one settles
   down into place. Rapid switching cancels the previous animation. */
function enterAnimation(view, direction) {
    view.getAnimations().forEach((a) => a.cancel());
    if (prefersReducedMotion() || direction === 0) {
        view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
        return;
    }
    view.animate(
        [{ opacity: 0, transform: `translateY(${direction * 14}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 450, easing: EASE_OUT });
}

/* Show the small top-bar title once the large title has scrolled beneath the bar. */
function watchTitle(heading) {
    titleObserver?.disconnect();
    const barHeight = topbar.getBoundingClientRect().height;
    titleObserver = new IntersectionObserver(([entry]) => {
        const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < barHeight;
        topbar.toggleAttribute('data-condensed', scrolledPast);
    }, { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 });
    titleObserver.observe(heading);
}

function show(name, { userInitiated }) {
    if (name === current) return;
    const direction = current ? Math.sign(VIEWS.indexOf(name) - VIEWS.indexOf(current)) : 0;
    current = name;

    for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${name}`;
    for (const link of links) {
        if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }

    const view = document.getElementById(`view-${name}`);
    const heading = view.querySelector('.large-title');
    const title = view.dataset.title;

    document.body.dataset.view = name;
    document.title = `${title} · BAS`;
    topbarTitle.textContent = title;
    topbar.removeAttribute('data-condensed');

    window.scrollTo({ top: 0, behavior: 'instant' });
    enterAnimation(view, direction);
    watchTitle(heading);
    if (userInitiated) heading.focus({ preventScroll: true });

    onEnter[name]?.();
}

function route(userInitiated) {
    const name = viewFromHash();
    if (!name) {
        history.replaceState(null, '', `#/${DEFAULT_VIEW}`);
        return show(DEFAULT_VIEW, { userInitiated: false });
    }
    show(name, { userInitiated });
}

initViews();
window.addEventListener('hashchange', () => route(true));
route(false);
