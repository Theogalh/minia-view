const api = globalThis.browser ?? globalThis.chrome;
const KEY = "thumbnailLab";
const DEFAULTS = { enabled: false, rate: 30, marker: true, title: "", items: [] };

const $ = (id) => document.getElementById(id);
let state = { ...DEFAULTS };
let pendingImage = null;

// Le popup se ferme des qu'il perd le focus — et ouvrir le selecteur de
// fichiers natif le lui fait perdre (systematique sur Firefox). La meme page
// chargee dans un onglet n'a pas ce probleme.
const inTab = new URLSearchParams(location.search).has("tab");
if (inTab) {
  document.body.classList.add("standalone");
  $("open-tab").hidden = true;
}
$("open-tab").addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("popup/popup.html?tab") });
  window.close();
});

async function save() {
  await api.storage.local.set({ [KEY]: state });
  render();
}

// Le stockage local d'une extension est limite (~10 Mo) : on recadre en 640x360
// et on encode en JPEG avant de garder quoi que ce soit.
function downscale(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const W = 640;
        const H = 360;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(W / img.width, H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function takeFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  pendingImage = await downscale(file);
  const preview = $("preview");
  preview.src = pendingImage;
  preview.hidden = false;
  $("dropzone").hidden = true;
}

function clearForm() {
  pendingImage = null;
  $("file").value = "";
  $("preview").hidden = true;
  $("dropzone").hidden = false;
}

function render() {
  $("enabled").checked = state.enabled;
  $("marker").checked = state.marker;
  $("count").textContent = String(state.items.length);
  // Ne pas ecraser le champ pendant que l'utilisateur tape dedans.
  if (document.activeElement !== $("title")) $("title").value = state.title;

  for (const btn of $("rate").querySelectorAll("button")) {
    const on = Number(btn.dataset.rate) === state.rate;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-checked", String(on));
  }

  $("status").textContent = !state.enabled
    ? "Inactive. Nothing is replaced."
    : state.items.length
      ? `${state.items.length} in pool. Replacing ${state.rate}% of videos.`
      : state.title
        ? `Title only. Replacing ${state.rate}% of titles.`
        : "Add a thumbnail or a title to start.";

  const list = $("list");
  list.textContent = "";

  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const dot = document.createElement("span");
    dot.className = "dot faint";
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nothing to inject yet.";
    empty.append(dot, p);
    list.append(empty);
    return;
  }

  for (const item of state.items) {
    const row = document.createElement("div");
    row.className = "pool-row";

    const thumb = document.createElement("img");
    thumb.src = item.image ?? "";
    thumb.alt = "";

    const main = document.createElement("span");
    main.className = "row-main";

    const del = document.createElement("button");
    del.className = "btn btn-danger btn-sm";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      state.items = state.items.filter((it) => it.id !== item.id);
      save();
    });

    row.append(thumb, main, del);
    list.append(row);
  }
}

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!pendingImage) return;
  state.items = [...state.items, { id: crypto.randomUUID(), image: pendingImage }];
  clearForm();
  save();
});

// Le titre est global : sauve a la frappe (debounce), applique a chaud
// par le content script via storage.onChanged.
let titleTimer = null;
$("title").addEventListener("input", (e) => {
  state.title = e.target.value.trim();
  clearTimeout(titleTimer);
  titleTimer = setTimeout(save, 300);
});

$("reset").addEventListener("click", clearForm);
$("dropzone").addEventListener("click", () => $("file").click());
$("dropzone").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") $("file").click();
});
$("file").addEventListener("change", (e) => takeFile(e.target.files[0]));
$("preview").addEventListener("click", clearForm);

for (const type of ["dragenter", "dragover"]) {
  $("dropzone").addEventListener(type, (e) => {
    e.preventDefault();
    $("dropzone").classList.add("active");
  });
}
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("active"));
$("dropzone").addEventListener("drop", (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("active");
  takeFile(e.dataTransfer.files[0]);
});

$("enabled").addEventListener("change", (e) => {
  state.enabled = e.target.checked;
  save();
});
$("marker").addEventListener("change", (e) => {
  state.marker = e.target.checked;
  save();
});
$("rate").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-rate]");
  if (!btn) return;
  state.rate = Number(btn.dataset.rate);
  save();
});

api.storage.local.get(KEY).then((data) => {
  state = { ...DEFAULTS, ...(data[KEY] ?? {}) };
  // Migration : les items "titre seul" d'avant le titre global n'ont plus de sens.
  state.items = state.items.filter((it) => it.image);
  render();
});

// L'onglet peut rester ouvert longtemps : suivre les changements faits ailleurs.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[KEY]) return;
  state = { ...DEFAULTS, ...(changes[KEY].newValue ?? {}) };
  render();
});
