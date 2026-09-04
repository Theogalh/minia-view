const api = globalThis.browser ?? globalThis.chrome;
const KEY = "thumbnailLab";
const ACCENT = "#8b93f8";

const CARD_SEL = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-video-renderer",
  "yt-lockup-view-model"
].join(",");

// Deux generations de DOM coexistent : les anciens renderers (recherche…) avec
// des classes BEM/ids, et les nouveaux view models (accueil, chaines, sidebar)
// avec des classes camelCase. Dans un lockup, l'avatar de chaine est aussi un
// <img> : on ne cible que celui du yt-thumbnail-view-model, avatar exclu.
const IMG_SEL = [
  "yt-thumbnail-view-model img:not(.ytSpecAvatarShapeImage)",
  "img.yt-core-image",
  "img#img",
  "yt-image img",
  "ytd-thumbnail img"
].join(",");
const TITLE_SEL = [
  "#video-title",
  "#video-title-link",
  "a.ytLockupMetadataViewModelTitle",
  "a.yt-lockup-metadata-view-model__title",
  "h3 a[title]"
].join(",");

let state = { enabled: false, rate: 30, marker: true, title: "", items: [] };
let pool = [];

// FNV-1a : le meme videoId doit toujours tomber sur la meme fausse miniature,
// sinon l'UI clignote a chaque re-render de YouTube.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(videoId) {
  if (!state.enabled) return null;
  if (!state.title && pool.length === 0) return null;
  const h = hash(videoId);
  if (h % 100 >= state.rate) return null;
  // Titre seul, sans image dans le pool : on remplace quand meme les titres.
  if (pool.length === 0) return { id: "title-only", image: null };
  return pool[(h >>> 9) % pool.length];
}

function videoIdOf(card) {
  const link = card.querySelector('a[href*="/watch?v="]');
  if (!link) return null;
  try {
    return new URL(link.getAttribute("href"), location.origin).searchParams.get("v");
  } catch {
    return null;
  }
}

function textNode(el) {
  return (
    el.querySelector("span.yt-core-attributed-string, span.ytAttributedStringHost") ?? el
  );
}

function forget(card, img, titleEl) {
  delete card.dataset.tlVideo;
  delete card.dataset.tlItem;
  if (img) {
    delete img.dataset.tlSrc;
    delete img.dataset.tlSrcset;
  }
  if (titleEl) delete textNode(titleEl).dataset.tlText;
}

function restore(card, img, titleEl) {
  if (!card.dataset.tlItem) return;
  if (img && img.dataset.tlSrc !== undefined) {
    img.src = img.dataset.tlSrc;
    if (img.dataset.tlSrcset) img.srcset = img.dataset.tlSrcset;
    img.style.removeProperty("object-fit");
    img.style.removeProperty("outline");
    img.style.removeProperty("outline-offset");
  }
  if (titleEl) {
    const t = textNode(titleEl);
    if (t.dataset.tlText !== undefined) t.textContent = t.dataset.tlText;
  }
  forget(card, img, titleEl);
}

// Appelee aussi sur les cards deja injectees : le toggle du popup doit se
// refleter sans recharger l'onglet.
function syncMarker(img) {
  if (!img || img.dataset.tlSrc === undefined) return;
  if (state.marker) {
    img.style.outline = `2px solid ${ACCENT}`;
    img.style.outlineOffset = "-2px";
  } else {
    img.style.removeProperty("outline");
    img.style.removeProperty("outline-offset");
  }
}

// Le titre est global (state.title) et s'applique a toutes les cards injectees.
// Appelee aussi quand le titre change ou est vide : on bascule a chaud.
function applyTitle(titleEl) {
  if (!titleEl) return;
  const t = textNode(titleEl);
  if (state.title) {
    if (t.dataset.tlText === undefined) t.dataset.tlText = t.textContent ?? "";
    // Pas de innerHTML : YouTube applique require-trusted-types-for 'script',
    // les sinks HTML lancent une exception. textContent passe toujours.
    t.textContent = state.title;
    titleEl.setAttribute("title", state.title);
    titleEl.setAttribute("aria-label", state.title);
  } else if (t.dataset.tlText !== undefined) {
    t.textContent = t.dataset.tlText;
    titleEl.setAttribute("title", t.dataset.tlText);
    titleEl.setAttribute("aria-label", t.dataset.tlText);
    delete t.dataset.tlText;
  }
}

function apply(card, img, titleEl, item, videoId) {
  if (img && item.image) {
    if (img.dataset.tlSrc === undefined) {
      img.dataset.tlSrc = img.getAttribute("src") ?? "";
      img.dataset.tlSrcset = img.getAttribute("srcset") ?? "";
    }
    img.removeAttribute("srcset");
    img.src = item.image;
    img.style.objectFit = "cover";
    syncMarker(img);
  }

  applyTitle(titleEl);

  card.dataset.tlVideo = videoId;
  card.dataset.tlItem = item.id;
}

function handleCard(card) {
  const videoId = videoIdOf(card);
  if (!videoId) return;

  const img = card.querySelector(IMG_SEL);
  const titleEl = card.querySelector(TITLE_SEL);
  if (!img && !titleEl) return;

  // YouTube recycle ses custom elements : le meme <ytd-rich-item-renderer>
  // peut servir une autre video apres une navigation. Nos marques sont perimees.
  if (card.dataset.tlVideo && card.dataset.tlVideo !== videoId) {
    forget(card, img, titleEl);
  }

  const item = pick(videoId);
  if (!item) {
    restore(card, img, titleEl);
    return;
  }

  const imgOk = !img || !item.image || img.src.startsWith("data:");
  const t = titleEl && textNode(titleEl);
  const titleOk =
    !titleEl ||
    (state.title ? t.textContent === state.title : t.dataset.tlText === undefined);
  if (card.dataset.tlItem === item.id && imgOk && titleOk) {
    syncMarker(img);
    return;
  }

  apply(card, img, titleEl, item, videoId);
}

function sweep() {
  for (const card of document.querySelectorAll(CARD_SEL)) {
    try {
      handleCard(card);
    } catch {
      /* une card exotique ne doit pas casser la passe */
    }
  }
}

let pending = null;
function schedule() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    sweep();
  }, 150);
}

function setState(next) {
  state = { ...state, ...next };
  pool = (state.items ?? []).filter((it) => it.image);
  sweep();
}

api.storage.local.get(KEY).then((data) => {
  setState(data[KEY] ?? {});
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("yt-navigate-finish", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  // Filet de securite : YouTube reecrit parfois un src apres coup, hors mutation observee.
  setInterval(sweep, 1500);
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[KEY]) return;
  setState(changes[KEY].newValue ?? {});
});
