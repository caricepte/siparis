// Kendi Supabase proje adresini yaz.
const SUPABASE_URL = "https://emmlaxobthlzocqdgdcn.supabase.co";

const LINK_CODE = /^[0-9A-Za-z]{20,24}$/;
const PRODUCT_KEY = /^[A-Za-z0-9_-]{12}$/;
const NAME_KEY = "cc_name";

function norm(text) {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/ı/g, "i")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cleanLabel(value, max) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function parseProducts(list) {
  if (!Array.isArray(list)) return [];
  const products = [];
  for (let i = 0; i < list.length; i++) {
    const pair = list[i];
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const pk = pair[0];
    const name = cleanLabel(pair[1], 120);
    if (typeof pk !== "string" || !PRODUCT_KEY.test(pk) || !name) continue;
    products.push({ pk: pk, name: name });
  }
  return products;
}

function parseCatalog(body) {
  if (!body || body.ok !== true) return null;
  if (body.c !== null && body.c !== undefined && !Array.isArray(body.c)) return null;
  const source = Array.isArray(body.c) ? body.c : [];
  const classes = [];
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const name = cleanLabel(item.n, 60);
    if (!name) continue;
    const subs = [];
    if (Array.isArray(item.s)) {
      for (let s = 0; s < item.s.length; s++) {
        const sub = item.s[s];
        if (!sub || typeof sub !== "object" || Array.isArray(sub)) continue;
        const subName = cleanLabel(sub.n, 60);
        if (!subName) continue;
        subs.push({ name: subName, products: parseProducts(sub.p) });
      }
    }
    classes.push({
      name: name,
      subs: subs,
      products: parseProducts(item.p),
    });
  }
  let cv = null;
  if (Number.isInteger(body.cv) && body.cv >= 0 && body.cv <= 2147483647) cv = body.cv;
  const rawName = typeof body.name === "string" ? cleanLabel(body.name, 60) : "";
  return {
    name: rawName || "Sipariş formu",
    rawName: rawName,
    cv: cv,
    accepting: body.accepting !== false,
    classes: classes,
  };
}

function viewOf(catalog, query, classOpen, subOpen) {
  const q = norm(query.trim());
  return catalog.classes.map(function (cls, ci) {
    const classHit = q !== "" && norm(cls.name).indexOf(q) !== -1;
    const subs = cls.subs.map(function (sub, si) {
      const subHit = q !== "" && norm(sub.name).indexOf(q) !== -1;
      const products = sub.products.map(function (product) {
        const productHit = q !== "" && norm(product.name).indexOf(q) !== -1;
        return {
          product: product,
          show: q === "" || classHit || subHit || productHit,
        };
      });
      const productHit = products.some(function (item) {
        return q !== "" && norm(item.product.name).indexOf(q) !== -1;
      });
      const key = ci + "/" + si;
      const show = q === "" || classHit || subHit || productHit;
      const open = show && (q === "" ? subOpen.has(key) : (subHit || productHit || subOpen.has(key)));
      return { name: sub.name, products: products, show: show, open: open, key: key };
    });
    const loose = cls.products.map(function (product) {
      const productHit = q !== "" && norm(product.name).indexOf(q) !== -1;
      return {
        product: product,
        show: q === "" || classHit || productHit,
      };
    });
    const anySub = subs.some(function (sub) { return sub.show; });
    const anyLoose = loose.some(function (item) { return item.show; });
    const show = q === "" || classHit || anySub || anyLoose;
    const open = show && (q === "" ? classOpen.has(String(ci)) : true);
    return { name: cls.name, subs: subs, loose: loose, show: show, open: open };
  });
}

const STRIP = /[\u0000-\u001F\u007F-\u009F\u180E\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

function charLength(text) {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}

function cleanText(value) {
  const collapsed = String(value).trim().replace(/\s+/g, " ");
  return collapsed.replace(STRIP, "").trim().replace(/\s+/g, " ");
}

function nameProblem(value) {
  const name = cleanText(value);
  if (!name) return "Adınızı yazın.";
  if (charLength(name) < 2 || charLength(name) > 60) return "Ad 2 ile 60 karakter olmalı.";
  return "";
}

function clampNote(value) {
  const stripped = String(value).replace(STRIP, "");
  const chars = Array.from(stripped);
  let text = chars.length > 200 ? chars.slice(0, 200).join("") : stripped;
  const words = text.match(/\S+/g);
  if (!words || words.length <= 25) return text;
  let count = 0;
  let out = "";
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      if (count > 0 && count < 25) out += part;
      continue;
    }
    if (count >= 25) break;
    out += part;
    count += 1;
  }
  return out;
}

const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function isCalendarDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

function fallbackIstanbul(now) {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const year = String(shifted.getUTCFullYear());
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const text = year + "-" + month + "-" + day;
  return isCalendarDay(text) ? text : "";
}

function istanbulDay(now) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Istanbul",
      calendar: "gregory",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const take = function (type) {
      const found = parts.find(function (part) { return part.type === type; });
      return found && found.value ? found.value.replace(/\D/g, "") : "";
    };
    const year = take("year");
    const month = take("month");
    const day = take("day");
    if (year.length !== 4 || month.length < 1 || month.length > 2 || day.length < 1 || day.length > 2) {
      return fallbackIstanbul(now);
    }
    const text = year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
    return isCalendarDay(text) ? text : fallbackIstanbul(now);
  } catch (err) {
    return fallbackIstanbul(now);
  }
}

function formatDelivery(iso) {
  const day = String(Number(iso.slice(8, 10)));
  const month = TR_MONTHS[Number(iso.slice(5, 7)) - 1];
  return day + " " + month + " " + iso.slice(0, 4);
}

function noteToSend(checked, value) {
  if (!checked) return null;
  const note = cleanText(value);
  if (!note) return null;
  if (charLength(note) > 200 || note.split(" ").length > 25) return "over";
  return note;
}

function countProducts(catalog) {
  let total = 0;
  if (!catalog) return total;
  for (let i = 0; i < catalog.classes.length; i++) {
    total += catalog.classes[i].products.length;
    for (let s = 0; s < catalog.classes[i].subs.length; s++) {
      total += catalog.classes[i].subs[s].products.length;
    }
  }
  return total;
}

function newRid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const part = bytes[i].toString(16);
    hex += part.length === 1 ? "0" + part : part;
  }
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

function submitOutcome(status, body) {
  if (status === 200 && body && body.ok === true) return "ok";
  const code = body && body.error && typeof body.error.code === "string" ? body.error.code : "";
  if (status === 404 || code === "LINK_NOT_FOUND") return "invalid";
  if (code === "CATALOG_CHANGED") return "changed";
  if (code === "NOT_ACCEPTING") return "closed";
  if (status === 429 || code === "RATE_LIMIT" || code === "INBOX_FULL") return "limit";
  if (status === 503 || code === "UNAVAILABLE") return "down";
  return "stay";
}

function catalogUrl(link) {
  const base = SUPABASE_URL.trim().replace(/\/+$/, "");
  if (base.indexOf("https://") !== 0) return null;
  return base + "/functions/v1/order-link-public?k=" + encodeURIComponent(link);
}

function readCatalog(link, cv, fetcher) {
  const url = catalogUrl(link);
  if (!url) return Promise.resolve({ kind: "skip" });
  const headers = { accept: "application/json" };
  if (Number.isInteger(cv)) headers["If-None-Match"] = '"' + String(cv) + '"';
  return fetcher(url, {
    method: "GET",
    headers: headers,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  }).then(function (response) {
    if (!response) return { kind: "down" };
    if (response.status === 304) return { kind: "not-modified" };
    if (response.status === 404) return { kind: "invalid" };
    if (response.status === 429) return { kind: "limit" };
    if (response.status !== 200) return { kind: "down" };
    return response.json().then(function (body) {
      const catalog = parseCatalog(body);
      if (!catalog || catalog.cv === null) return { kind: "down" };
      return { kind: "ok", catalog: catalog };
    }).catch(function () {
      return { kind: "down" };
    });
  }).catch(function () {
    return { kind: "down" };
  });
}

function loadCart(link) {
  const cart = Object.create(null);
  let raw = null;
  try {
    raw = localStorage.getItem("cc_cart_" + link);
  } catch (err) {
    return cart;
  }
  if (!raw) return cart;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return cart;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return cart;
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const pk = keys[i];
    const qty = data[pk];
    if (!PRODUCT_KEY.test(pk)) continue;
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) continue;
    cart[pk] = qty;
  }
  return cart;
}

function wireCatalog(catalog) {
  return {
    ok: true,
    cv: catalog.cv,
    name: catalog.rawName || null,
    accepting: catalog.accepting !== false,
    c: catalog.classes.map(function (cls) {
      return {
        n: cls.name,
        s: cls.subs.map(function (sub) {
          return {
            n: sub.name,
            p: sub.products.map(function (product) { return [product.pk, product.name]; }),
          };
        }),
        p: cls.products.map(function (product) { return [product.pk, product.name]; }),
      };
    }),
  };
}

function readSession(link) {
  let raw = null;
  try {
    raw = sessionStorage.getItem("cc_catalog_" + link);
  } catch (err) {
    return null;
  }
  if (!raw) return null;
  try {
    const catalog = parseCatalog(JSON.parse(raw));
    if (!catalog || catalog.cv === null) return null;
    return catalog;
  } catch (err) {
    return null;
  }
}

function writeSession(link, catalog) {
  if (!Number.isInteger(catalog.cv)) return;
  try {
    sessionStorage.setItem("cc_catalog_" + link, JSON.stringify(wireCatalog(catalog)));
  } catch (err) {
    // Oturum kotası doluysa liste bellekte kalır.
  }
}

function boot() {
  if (window.top !== window.self) {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    const note = document.createElement("p");
    note.className = "frame-block";
    note.textContent = "Bu sayfa çerçeve içinde açılamaz.";
    document.body.appendChild(note);
    return;
  }

  const openedAt = Date.now();
  let rid = newRid();
  let sending = false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("k") || "";
  const sayfa = document.getElementById("sayfa");
  const nameInput = document.getElementById("ad");
  const nameWarning = document.getElementById("ad-uyari");
  const searchInput = document.getElementById("ara");
  const catalogRoot = document.getElementById("katalog");
  const empty = document.getElementById("bos");
  const title = document.getElementById("firma");
  const bar = document.getElementById("bar-metin");
  const gonder = document.getElementById("gonder");
  const cubuk = document.getElementById("cubuk");
  const noteToggle = document.getElementById("not-ekle");
  const noteBox = document.getElementById("not-alani");
  const noteInput = document.getElementById("not");
  const deliveryInput = document.getElementById("teslim");
  const deliveryText = document.getElementById("teslim-gun");
  const hpInput = document.getElementById("hp");
  const changedBanner = document.getElementById("guncelleme");
  const durum = document.getElementById("durum");
  const durumAd = document.getElementById("durum-ad");
  const durumMetin = document.getElementById("durum-metin");
  const basari = document.getElementById("basari");
  const perde = document.getElementById("perde");
  const ozet = document.getElementById("ozet");
  const ozetAd = document.getElementById("ozet-ad");
  const ozetUyari = document.getElementById("ozet-uyari");
  const ozetListe = document.getElementById("ozet-kalemler");
  const siparisButton = document.getElementById("siparisi-gonder");
  const duzenle = document.getElementById("duzenle");
  const classOpen = new Set();
  const subOpen = new Set();
  let current = null;
  let cart = Object.create(null);

  function showStatus(text) {
    closeSummary();
    basari.hidden = true;
    sayfa.hidden = true;
    cubuk.hidden = true;
    changedBanner.hidden = true;
    if (current && current.name) {
      durumAd.hidden = false;
      durumAd.textContent = current.name;
    } else {
      durumAd.hidden = true;
      durumAd.textContent = "";
    }
    durumMetin.textContent = text;
    durum.hidden = false;
  }

  function showForm() {
    durum.hidden = true;
    basari.hidden = true;
    sayfa.hidden = false;
    cubuk.hidden = false;
  }

  function closeSummary() {
    perde.hidden = true;
    ozet.hidden = true;
    sayfa.inert = false;
    cubuk.inert = false;
    document.body.classList.remove("sheet-open");
  }

  try {
    const savedName = localStorage.getItem(NAME_KEY);
    if (typeof savedName === "string") nameInput.value = savedName;
  } catch (err) {
    // Ad hatırlanamazsa alan boş kalır.
  }

  nameInput.addEventListener("input", function () {
    try {
      localStorage.setItem(NAME_KEY, nameInput.value);
    } catch (err) {
      // Kota doluysa tarayıcının kendi hatırlaması durur.
    }
  });

  if (!LINK_CODE.test(code)) {
    showStatus("Link geçersiz");
    return;
  }

  cart = loadCart(code);

  function saveCart() {
    const out = Object.create(null);
    const keys = Object.keys(cart);
    for (let i = 0; i < keys.length; i++) {
      const pk = keys[i];
      const qty = cart[pk];
      if (PRODUCT_KEY.test(pk) && Number.isInteger(qty) && qty >= 1 && qty <= 9999) out[pk] = qty;
    }
    try {
      const key = "cc_cart_" + code;
      if (Object.keys(out).length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(out));
    } catch (err) {
      // Seçim bu oturumda bellekte kalır.
    }
  }

  function knownProducts() {
    const seen = Object.create(null);
    if (!current) return seen;
    current.classes.forEach(function (cls) {
      cls.products.forEach(function (product) { seen[product.pk] = true; });
      cls.subs.forEach(function (sub) {
        sub.products.forEach(function (product) { seen[product.pk] = true; });
      });
    });
    return seen;
  }

  function updateBar() {
    const known = knownProducts();
    let kinds = 0;
    let total = 0;
    const keys = Object.keys(cart);
    for (let i = 0; i < keys.length; i++) {
      const pk = keys[i];
      if (!known[pk]) continue;
      const qty = cart[pk];
      if (!Number.isInteger(qty) || qty < 1) continue;
      kinds += 1;
      total += qty;
    }
    bar.textContent = kinds + " ürün · " + total + " adet";
    if (!sending) gonder.disabled = kinds < 1;
  }

  function productElement(product) {
    const qty = cart[product.pk] || 0;
    const row = document.createElement("div");
    row.className = qty > 0 ? "product is-on" : "product";
    row.dataset.pk = product.pk;

    const name = document.createElement("p");
    name.className = "product-name";
    name.textContent = product.name;

    const stepper = document.createElement("div");
    stepper.className = "stepper";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "step minus";
    minus.textContent = "−";
    minus.disabled = qty <= 0;
    minus.setAttribute("aria-label", product.name + " adedini azalt");

    const input = document.createElement("input");
    input.className = "qty";
    input.type = "text";
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("maxlength", "4");
    input.setAttribute("aria-label", product.name + " adedi");
    input.value = String(qty);
    input.spellcheck = false;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "step plus";
    plus.textContent = "+";
    plus.disabled = qty >= 9999;
    plus.setAttribute("aria-label", product.name + " adedini artır");

    stepper.appendChild(minus);
    stepper.appendChild(input);
    stepper.appendChild(plus);
    row.appendChild(name);
    row.appendChild(stepper);
    return row;
  }

  function render() {
    catalogRoot.replaceChildren();
    if (!current) {
      updateBar();
      empty.hidden = true;
      return;
    }
    title.textContent = current.name;
    document.title = current.name;
    const query = searchInput.value;
    const view = viewOf(current, query, classOpen, subOpen);
    let visible = 0;
    view.forEach(function (cls, ci) {
      if (!cls.show) return;
      visible += 1;
      const section = document.createElement("section");
      section.className = "cat";
      section.dataset.index = String(ci);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "cat-toggle";
      button.setAttribute("aria-expanded", cls.open ? "true" : "false");
      button.setAttribute("aria-controls", "govde-" + ci);

      const chev = document.createElement("span");
      chev.className = "chev";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = cls.open ? "▾" : "▸";

      const label = document.createElement("span");
      label.className = "cat-label";
      label.textContent = current.classes[ci].name;

      button.appendChild(chev);
      button.appendChild(label);

      const body = document.createElement("div");
      body.className = "cat-body";
      body.id = "govde-" + ci;
      body.hidden = !cls.open;

      cls.subs.forEach(function (sub, si) {
        if (!sub.show) return;
        const wrap = document.createElement("div");
        wrap.className = "sub";
        wrap.dataset.key = sub.key;

        const subButton = document.createElement("button");
        subButton.type = "button";
        subButton.className = "sub-toggle";
        subButton.setAttribute("aria-expanded", sub.open ? "true" : "false");
        subButton.setAttribute("aria-controls", "alt-" + ci + "-" + si);

        const subChev = document.createElement("span");
        subChev.className = "chev";
        subChev.setAttribute("aria-hidden", "true");
        subChev.textContent = sub.open ? "▾" : "▸";

        const subLabel = document.createElement("span");
        subLabel.className = "sub-label";
        subLabel.textContent = sub.name;

        subButton.appendChild(subChev);
        subButton.appendChild(subLabel);

        const subBody = document.createElement("div");
        subBody.className = "sub-body";
        subBody.id = "alt-" + ci + "-" + si;
        subBody.hidden = !sub.open;
        sub.products.forEach(function (item) {
          if (!item.show) return;
          subBody.appendChild(productElement(item.product));
        });

        wrap.appendChild(subButton);
        wrap.appendChild(subBody);
        body.appendChild(wrap);
      });

      const loose = document.createElement("div");
      loose.className = "loose";
      let looseCount = 0;
      cls.loose.forEach(function (item) {
        if (!item.show) return;
        looseCount += 1;
        loose.appendChild(productElement(item.product));
      });
      if (looseCount > 0) body.appendChild(loose);

      section.appendChild(button);
      section.appendChild(body);
      catalogRoot.appendChild(section);
    });
    empty.hidden = norm(query.trim()) === "" || visible !== 0;
    updateBar();
  }

  function setOpen(button, open) {
    const body = document.getElementById(button.getAttribute("aria-controls"));
    body.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.querySelector(".chev").textContent = open ? "▾" : "▸";
  }

  function readQty(value) {
    const raw = String(value).replace(/\D/g, "");
    if (!raw) return 0;
    const qty = parseInt(raw, 10);
    if (!qty || qty < 0) return 0;
    if (qty > 9999) return 9999;
    return qty;
  }

  function syncRows(pk, qty, source) {
    const rows = catalogRoot.querySelectorAll(".product");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].dataset.pk !== pk) continue;
      rows[i].classList.toggle("is-on", qty > 0);
      const minus = rows[i].querySelector(".minus");
      const plus = rows[i].querySelector(".plus");
      const field = rows[i].querySelector(".qty");
      minus.disabled = qty <= 0;
      plus.disabled = qty >= 9999;
      if (field !== source) field.value = String(qty);
    }
  }

  function commitQty(pk, qty) {
    if (qty > 0) cart[pk] = qty;
    else delete cart[pk];
    saveCart();
    updateBar();
  }

  catalogRoot.addEventListener("click", function (event) {
    const step = event.target.closest(".step");
    if (step) {
      if (step.disabled) return;
      const row = step.closest(".product");
      const field = row.querySelector(".qty");
      const next = readQty(field.value) + (step.classList.contains("plus") ? 1 : -1);
      const qty = next < 0 ? 0 : (next > 9999 ? 9999 : next);
      field.value = String(qty);
      syncRows(row.dataset.pk, qty, null);
      commitQty(row.dataset.pk, qty);
      return;
    }
    const subButton = event.target.closest(".sub-toggle");
    if (subButton) {
      const wrap = subButton.closest(".sub");
      const open = subButton.getAttribute("aria-expanded") !== "true";
      if (open) subOpen.add(wrap.dataset.key);
      else subOpen.delete(wrap.dataset.key);
      setOpen(subButton, open);
      return;
    }
    const classButton = event.target.closest(".cat-toggle");
    if (!classButton) return;
    const section = classButton.closest(".cat");
    const open = classButton.getAttribute("aria-expanded") !== "true";
    if (open) classOpen.add(section.dataset.index);
    else classOpen.delete(section.dataset.index);
    setOpen(classButton, open);
  });

  catalogRoot.addEventListener("input", function (event) {
    const field = event.target;
    if (!field.classList || !field.classList.contains("qty")) return;
    let raw = field.value.replace(/\D/g, "").slice(0, 4);
    if (raw.length > 1) raw = String(parseInt(raw, 10));
    if (field.value !== raw) field.value = raw;
    const qty = raw === "" ? 0 : readQty(raw);
    const row = field.closest(".product");
    syncRows(row.dataset.pk, qty, field);
    commitQty(row.dataset.pk, qty);
  });

  catalogRoot.addEventListener("focusin", function (event) {
    if (event.target.classList && event.target.classList.contains("qty")) event.target.select();
  });

  catalogRoot.addEventListener("focusout", function (event) {
    const field = event.target;
    if (!field.classList || !field.classList.contains("qty")) return;
    const qty = readQty(field.value);
    field.value = String(qty);
    const row = field.closest(".product");
    syncRows(row.dataset.pk, qty, null);
    commitQty(row.dataset.pk, qty);
  });

  searchInput.addEventListener("input", render);

  noteToggle.addEventListener("change", function () {
    noteBox.hidden = !noteToggle.checked;
    if (!noteToggle.checked) noteInput.value = "";
    else noteInput.focus();
  });

  noteInput.addEventListener("input", function () {
    const next = clampNote(noteInput.value);
    if (next !== noteInput.value) noteInput.value = next;
  });

  function showDelivery(iso) {
    deliveryInput.value = iso;
    deliveryText.textContent = formatDelivery(iso);
  }

  function chosenDelivery() {
    const value = deliveryInput.value;
    if (isCalendarDay(value)) return value;
    const today = istanbulDay(new Date());
    if (today) showDelivery(today);
    return today;
  }

  const openingDay = istanbulDay(new Date());
  if (openingDay) showDelivery(openingDay);

  deliveryInput.addEventListener("change", function () {
    const value = deliveryInput.value;
    if (isCalendarDay(value)) showDelivery(value);
    else if (openingDay) showDelivery(istanbulDay(new Date()) || openingDay);
  });

  function selectedLines() {
    const lines = [];
    const seen = Object.create(null);
    function add(product) {
      if (seen[product.pk]) return;
      seen[product.pk] = true;
      const qty = cart[product.pk];
      if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return;
      lines.push({ p: product.pk, q: qty, name: product.name });
    }
    if (!current) return lines;
    current.classes.forEach(function (cls) {
      cls.products.forEach(add);
      cls.subs.forEach(function (sub) { sub.products.forEach(add); });
    });
    return lines;
  }

  function pruneCart() {
    const known = knownProducts();
    const keys = Object.keys(cart);
    for (let i = 0; i < keys.length; i++) {
      if (!known[keys[i]]) delete cart[keys[i]];
    }
    saveCart();
  }

  function fillSummary() {
    ozetAd.textContent = cleanText(nameInput.value);
    ozetListe.replaceChildren();
    const lines = selectedLines();
    for (let i = 0; i < lines.length; i++) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "line-name";
      name.textContent = lines[i].name;
      const qty = document.createElement("span");
      qty.className = "line-qty";
      qty.textContent = lines[i].q + " adet";
      item.appendChild(name);
      item.appendChild(qty);
      ozetListe.appendChild(item);
    }
  }

  function openSummary() {
    if (sending || selectedLines().length < 1) return;
    fillSummary();
    nameWarning.hidden = true;
    ozetUyari.hidden = true;
    perde.hidden = false;
    ozet.hidden = false;
    sayfa.inert = true;
    cubuk.inert = true;
    document.body.classList.add("sheet-open");
  }

  function present(catalog, changed) {
    if (!current || current.cv !== catalog.cv) {
      classOpen.clear();
      subOpen.clear();
    }
    current = catalog;
    writeSession(code, current);
    pruneCart();
    if (catalog.accepting === false) {
      showStatus("Bu işletme şu an sipariş almıyor");
      return;
    }
    if (countProducts(catalog) === 0) {
      showStatus("Katalog boş");
      return;
    }
    showForm();
    render();
    changedBanner.hidden = !changed;
  }

  function refreshCatalog(changed) {
    return readCatalog(code, null, function (url, options) {
      return fetch(url, options);
    }).then(function (result) {
      if (result.kind === "invalid") {
        showStatus("Link geçersiz");
        return;
      }
      if (result.kind === "limit") {
        showStatus("Limit doldu");
        return;
      }
      if (result.kind !== "ok") {
        if (!current) showStatus("Bağlantı yok");
        return;
      }
      present(result.catalog, changed);
    });
  }

  function finishSuccess() {
    cart = Object.create(null);
    saveCart();
    noteToggle.checked = false;
    noteBox.hidden = true;
    noteInput.value = "";
    classOpen.clear();
    subOpen.clear();
    searchInput.value = "";
    rid = newRid();
    closeSummary();
    render();
    sayfa.hidden = true;
    cubuk.hidden = true;
    durum.hidden = true;
    changedBanner.hidden = true;
    basari.hidden = false;
  }

  function setSending(on) {
    sending = on;
    siparisButton.disabled = on;
    duzenle.disabled = on;
    gonder.disabled = on || selectedLines().length < 1;
  }

  function handleSubmitResult(outcome) {
    setSending(false);
    if (outcome === "ok") {
      finishSuccess();
      return;
    }
    if (outcome === "changed") {
      closeSummary();
      refreshCatalog(true);
      return;
    }
    if (outcome === "invalid") {
      showStatus("Link geçersiz");
      return;
    }
    if (outcome === "closed") {
      showStatus("Bu işletme şu an sipariş almıyor");
      return;
    }
    if (outcome === "limit") {
      showStatus("Limit doldu");
      return;
    }
    if (outcome === "down") {
      ozetUyari.textContent = "Bağlantı yok";
      ozetUyari.hidden = false;
      return;
    }
  }

  function sendOrder() {
    if (sending) return;
    const problem = nameProblem(nameInput.value);
    if (problem) {
      nameWarning.textContent = problem;
      nameWarning.hidden = false;
      closeSummary();
      nameInput.focus();
      return;
    }
    nameWarning.hidden = true;
    const note = noteToSend(noteToggle.checked, noteInput.value);
    if (note === "over") return;
    const lines = selectedLines();
    if (lines.length < 1 || lines.length > 100 || !current || current.cv === null) return;
    const delivery = chosenDelivery();
    if (!isCalendarDay(delivery)) return;
    const payload = {
      v: 1,
      k: code,
      rid: rid,
      name: cleanText(nameInput.value),
      note: note,
      cv: current.cv,
      lines: lines.map(function (line) { return { p: line.p, q: line.q }; }),
      hp: typeof hpInput.value === "string" ? hpInput.value : "",
      t: Math.max(0, Date.now() - openedAt),
      delivery: delivery,
    };
    const url = catalogUrl(code);
    if (!url) return;
    const postUrl = url.split("?")[0];
    setSending(true);
    fetch(postUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    }).then(function (response) {
      if (response.status === 200) {
        return response.json().then(function (body) {
          handleSubmitResult(submitOutcome(response.status, body));
        }).catch(function () {
          handleSubmitResult("stay");
        });
      }
      return response.json().then(function (body) {
        handleSubmitResult(submitOutcome(response.status, body));
      }).catch(function () {
        handleSubmitResult(submitOutcome(response.status, null));
      });
    }).catch(function () {
      setSending(false);
      ozetUyari.textContent = "Bağlantı yok";
      ozetUyari.hidden = false;
    });
  }

  gonder.addEventListener("click", openSummary);
  siparisButton.addEventListener("click", sendOrder);
  duzenle.addEventListener("click", function () {
    if (sending) return;
    closeSummary();
    gonder.focus();
  });
  perde.addEventListener("click", function () {
    if (sending) return;
    closeSummary();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !ozet.hidden && !sending) closeSummary();
  });
  document.getElementById("yeni-siparis").addEventListener("click", function () {
    basari.hidden = true;
    showForm();
    render();
  });

  const cached = readSession(code);
  if (cached) {
    current = cached;
    if (cached.accepting === false) showStatus("Bu işletme şu an sipariş almıyor");
    else if (countProducts(cached) === 0) showStatus("Katalog boş");
    else render();
  }

  readCatalog(code, cached ? cached.cv : null, function (url, options) {
    return fetch(url, options);
  }).then(function (result) {
    if (result.kind === "not-modified") return;
    if (result.kind === "invalid") {
      showStatus("Link geçersiz");
      return;
    }
    if (result.kind === "limit") {
      showStatus("Limit doldu");
      return;
    }
    if (result.kind !== "ok") {
      if (!current) showStatus("Bağlantı yok");
      return;
    }
    present(result.catalog, false);
  });
}

if (typeof document !== "undefined") boot();
