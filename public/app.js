const form = document.getElementById("nav");
const addr = document.getElementById("addr");
const frame = document.getElementById("frame");
const progress = document.getElementById("progress");

const stack = [];
let cursor = -1;
let timer = null;

const toProxy = (abs) =>
  "/api/p/" + btoa(String.fromCharCode(...new TextEncoder().encode(abs)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

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

  progress.classList.remove("done");
  progress.classList.add("on");
  clearTimeout(timer);
  timer = setTimeout(() => {
    progress.classList.remove("on");
    progress.classList.add("done");
  }, 6000);

  frame.src = toProxy(url);
}

function go(input, push = true) {
  const url = normalize(input);
  if (!url) {
    addr.focus();
    return;
  }
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

document.getElementById("back").onclick = () => {
  if (cursor > 0) {
    cursor--;
    render();
  }
};

document.getElementById("fwd").onclick = () => {
  if (cursor < stack.length - 1) {
    cursor++;
    render();
  }
};

document.getElementById("reload").onclick = () => {
  if (stack[cursor]) render();
};

document.querySelectorAll("[data-url]").forEach((b) => {
  b.addEventListener("click", () => go(b.dataset.url));
});

frame.addEventListener("load", () => {
  progress.classList.remove("on");
  progress.classList.add("done");
});

// 起動時にハッシュから復元（共有用）
window.addEventListener("load", () => {
  const h = location.hash.slice(1);
  if (h) go(decodeURIComponent(h), false) || (cursor = 0);
});