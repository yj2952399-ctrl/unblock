const form = document.getElementById("nav");
const addr = document.getElementById("addr");
const modeSel = document.getElementById("mode");
const frame = document.getElementById("frame");
const progress = document.getElementById("progress");

const stack = [];
let cursor = -1;
let slowTimer = null;

const b64 = (s) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function normalize(input) {
  let v = input.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function render() {
  const url = stack[cursor];
  if (!url) return;
  addr.value = url;
  document.body.classList.add("browsing");

  progress.className = "on";
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => progress.classList.add("slow"), 1500);

  // モードをパスに載せる → リンクを辿っても維持される
  frame.src = `/api/${modeSel.value}/${b64(url)}`;
}

function go(input, push = true) {
  const url = normalize(input);
  if (!url) return addr.focus();
  if (push) {
    stack.length = cursor + 1;
    stack.push(url);
    cursor = stack.length - 1;
  }
  render();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  go(addr.value);
});

modeSel.addEventListener("change", () => {
  if (stack[cursor]) render();
});

document.getElementById("back").onclick = () => {
  if (cursor > 0) { cursor--; render(); }
};
document.getElementById("fwd").onclick = () => {
  if (cursor < stack.length - 1) { cursor++; render(); }
};
document.getElementById("reload").onclick = () => {
  if (stack[cursor]) render();
};
document.querySelectorAll("[data-url]").forEach((b) =>
  b.addEventListener("click", () => go(b.dataset.url))
);

frame.addEventListener("load", () => {
  clearTimeout(slowTimer);
  progress.className = "done";
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}