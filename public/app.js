const $ = (selector, root = document) => root.querySelector(selector);
const state = { store: null, products: [] };
const toast = (text) => { const el = $("#toast"); el.textContent = text; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 3000); };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (value) => `${Number(value || 0).toFixed(2)} ${escapeHtml(state.store?.settings?.currency || "MAD")}`;

async function loadStore() {
  const response = await fetch("/api/store");
  if (!response.ok) throw new Error("store");
  state.store = await response.json();
  state.products = state.store.products || [];
  const settings = state.store.settings || {};
  $("#brandName").textContent = settings.storeName || "Elkhalfy";
  $("#brandMark").textContent = settings.logoText || "E";
  $("#footerName").textContent = settings.storeName || "Elkhalfy";
  $("#footerDescription").textContent = settings.description || settings.tagline || "";
  document.documentElement.style.setProperty("--primary", settings.primaryColor || "#05d6ad");
  renderHero(state.store.slides || []);
  renderFilters(state.store.categories || []);
  renderProducts("all");
  renderContact(settings);
}
function renderHero(slides) {
  const active = slides.filter(s => s.active && s.image_url);
  if (!active.length) return;
  const hero = $("#hero");
  const slide = active[0];
  hero.style.background = `linear-gradient(90deg,#0d192de8,#122840aa),url("${encodeURI(slide.image_url)}") center/cover`;
  $("#heroTitle").textContent = slide.title || "اكتشف منتجاتك الرقمية بسهولة";
  $("#heroSubtitle").textContent = slide.subtitle || "تجربة متجر بسيطة، سريعة، ومناسبة لكل الأجهزة.";
  const dots = $("#heroDots");
  dots.innerHTML = active.map((_, i) => `<i class="${i === 0 ? "active" : ""}"></i>`).join("");
  if (active.length > 1) {
    let index = 0;
    setInterval(() => { index = (index + 1) % active.length; const s = active[index]; hero.style.background = `linear-gradient(90deg,#0d192de8,#122840aa),url("${encodeURI(s.image_url)}") center/cover`; $("#heroTitle").textContent = s.title || ""; $("#heroSubtitle").textContent = s.subtitle || ""; [...dots.children].forEach((d, i) => d.classList.toggle("active", i === index)); }, 4500);
  }
}
function renderFilters(categories) {
  $("#filters").innerHTML = [`<button class="filter active" data-filter="all">الكل</button>`, ...categories.map(c => `<button class="filter" data-filter="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`)].join("");
  $("#filters").addEventListener("click", event => { const btn = event.target.closest(".filter"); if (!btn) return; document.querySelectorAll(".filter").forEach(x => x.classList.remove("active")); btn.classList.add("active"); renderProducts(btn.dataset.filter); });
}
function renderProducts(filter = "all") {
  const list = state.products.filter(p => filter === "all" || String(p.category_id || p.categoryId) === String(filter));
  $("#productGrid").innerHTML = list.length ? list.map(productCard).join("") : `<div class="empty-state">لا توجد منتجات في هذا التصنيف حالياً.<br><small>أضفها من لوحة التحكم.</small></div>`;
  $("#productGrid").querySelectorAll("[data-product]").forEach(card => card.addEventListener("click", () => openProduct(Number(card.dataset.product))));
}
function productCard(product) {
  const image = product.thumbnail || product.images?.[0];
  return `<article class="product-card" data-product="${product.id}"><div class="product-media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : `<span class="empty-state">بدون صورة</span>`}${product.badge ? `<span class="badge">${escapeHtml(product.badge)}</span>` : ""}</div><div class="product-body"><span class="eyebrow">${escapeHtml(product.category_name || "منتج")}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><div class="product-bottom"><strong class="price">${money(product.price)}</strong><button class="small-btn">التفاصيل</button></div></div></article>`;
}
function openProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  const images = [product.thumbnail, ...(product.images || [])].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  $("#productModalBody").innerHTML = `<div class="detail-grid"><div><img class="detail-image" id="detailImage" src="${escapeHtml(images[0] || "")}" alt="${escapeHtml(product.name)}"><div class="detail-thumbs">${images.map((image, i) => `<img src="${escapeHtml(image)}" data-image="${escapeHtml(image)}" class="${i === 0 ? "active" : ""}" alt="">`).join("")}</div></div><div><span class="eyebrow">${escapeHtml(product.category_name || "منتج")}</span><h2>${escapeHtml(product.name)}</h2><p class="muted">${escapeHtml(product.description)}</p>${product.video_url ? `<video controls preload="metadata" style="width:100%;border-radius:12px;margin:10px 0" src="${escapeHtml(product.video_url)}"></video>` : ""}<h3 class="price">${money(product.price)}</h3><button class="btn primary" id="orderProductBtn">اطلب الآن</button></div></div>`;
  $("#productModal").hidden = false;
  $("#productModalBody").querySelectorAll("[data-image]").forEach(img => img.addEventListener("click", () => { $("#detailImage").src = img.dataset.image; }));
  $("#orderProductBtn").addEventListener("click", () => { $("#productModal").hidden = true; openOrder(product); });
}
function openOrder(product) { $("#orderProduct").textContent = `${product.name} — ${money(product.price)}`; $("#orderForm [name=productId]").value = product.id; $("#orderModal").hidden = false; $("#orderForm [name=name]").focus(); }
function renderContact(settings) { const links = [["واتساب", settings.whatsapp], ["الهاتف", settings.phone], ["Instagram", settings.instagram], ["Facebook", settings.facebook]].filter(([, value]) => value); $("#contactLinks").className = "contact-links"; $("#contactLinks").innerHTML = links.map(([label, value]) => `<a class="contact-link" href="${escapeHtml(value)}">${escapeHtml(label)}</a>`).join(""); }
async function sendForm(form, endpoint, messageElement) { const button = form.querySelector("button[type=submit]"); button.disabled = true; try { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر الإرسال"); messageElement.textContent = endpoint.includes("orders") ? `تم إرسال الطلب. كود المتابعة: ${data.trackingCode}` : "تم إرسال رسالتك بنجاح."; form.reset(); } catch (error) { messageElement.textContent = error.message; } finally { button.disabled = false; } }
$("#orderForm").addEventListener("submit", event => { event.preventDefault(); sendForm(event.currentTarget, "/api/orders", $("#orderMessage")); });
$("#contactForm").addEventListener("submit", event => { event.preventDefault(); sendForm(event.currentTarget, "/api/messages", $("#contactMessage")); });
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => { $(`#${button.dataset.close}`).hidden = true; }));
document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", event => { if (event.target === backdrop) backdrop.hidden = true; }));
$("#themeToggle").addEventListener("click", () => { document.body.classList.toggle("dark"); localStorage.setItem("elkhalfy-theme", document.body.classList.contains("dark") ? "dark" : "light"); });
if (localStorage.getItem("elkhalfy-theme") === "dark") document.body.classList.add("dark");
loadStore().catch(() => toast("تعذر تحميل المتجر حالياً."));