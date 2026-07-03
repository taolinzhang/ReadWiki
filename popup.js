const repoInput = document.getElementById("repoInput");
const currentTabButton = document.getElementById("currentTab");
const message = document.getElementById("message");
let currentTarget = null;

function normalizePath(path = "") {
  const segments = [];
  for (const part of String(path).replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

function parseRepoInput(input) {
  const value = input.trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    try {
      url = new URL(`https://github.com/${value.replace(/^@/, "")}`);
    } catch {
      return null;
    }
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts[1],
      branch: parts[2] || "",
      path: normalizePath(parts.slice(3).join("/")),
      anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ""
    };
  }

  if (url.hostname !== "github.com" || parts.length < 2) return null;

  if (parts[2] === "blob" || parts[2] === "tree") {
    return {
      owner: parts[0],
      repo: parts[1],
      branch: parts[3] || "",
      path: normalizePath(parts.slice(4).join("/")),
      anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ""
    };
  }

  return {
    owner: parts[0],
    repo: parts[1],
    branch: "",
    path: "",
    anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ""
  };
}

function buildViewerUrl(target) {
  const params = new URLSearchParams();
  params.set("owner", target.owner);
  params.set("repo", target.repo);
  if (target.branch) params.set("branch", target.branch);
  if (target.path) params.set("path", target.path);
  if (target.anchor) params.set("anchor", target.anchor.replace(/^#/, ""));
  return chrome.runtime.getURL(`viewer.html?${params.toString()}`);
}

function openTarget(target) {
  chrome.tabs.create({ url: buildViewerUrl(target) });
}

document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const target = parseRepoInput(repoInput.value);
  if (!target) {
    message.textContent = "Enter owner/repo or paste a GitHub URL.";
    return;
  }
  openTarget(target);
});

currentTabButton.addEventListener("click", () => {
  if (currentTarget) openTarget(currentTarget);
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const target = tab?.url ? parseRepoInput(tab.url) : null;
  if (!target) {
    message.textContent = "Current tab is not a GitHub repository.";
    return;
  }

  currentTarget = target;
  repoInput.value = `${target.owner}/${target.repo}`;
  currentTabButton.disabled = false;
  message.textContent = tab.title || "";
});
