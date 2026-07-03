const state = {
  owner: "",
  repo: "",
  branch: "",
  path: "",
  anchor: "",
  repoInfo: null,
  documentInfo: null
};

const els = {
  repoForm: document.getElementById("repoForm"),
  repoInput: document.getElementById("repoInput"),
  heroForm: document.getElementById("heroForm"),
  heroInput: document.getElementById("heroInput"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  document: document.getElementById("document"),
  repoName: document.getElementById("repoName"),
  repoDescription: document.getElementById("repoDescription"),
  repoBranch: document.getElementById("repoBranch"),
  repoStars: document.getElementById("repoStars"),
  githubLink: document.getElementById("githubLink"),
  rawLink: document.getElementById("rawLink"),
  toc: document.getElementById("toc")
};

const README_CANDIDATES = ["README.md", "README.markdown", "README.mdown", "README.txt", "README.rst"];
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkdn", ".mkd", ".rst"]);
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "textarea",
  "select"
]);

function apiUrl(path) {
  return `https://api.github.com${path}`;
}

function encodePath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizePath(path = "") {
  const segments = [];
  for (const part of String(path).replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

function dirname(path = "") {
  const clean = normalizePath(path);
  if (!clean || !clean.includes("/")) return "";
  return clean.slice(0, clean.lastIndexOf("/"));
}

function joinPath(base, child) {
  return normalizePath(`${base ? `${base}/` : ""}${child || ""}`);
}

function extensionOf(path = "") {
  const name = path.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function isMarkdownPath(path = "") {
  const name = path.split("/").pop() || "";
  return /^readme(\.|$)/i.test(name) || MARKDOWN_EXTENSIONS.has(extensionOf(path));
}

function isLikelyDirectory(path = "") {
  if (!path) return true;
  if (path.endsWith("/")) return true;
  return extensionOf(path) === "";
}

function humanNumber(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m stars`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k stars`;
  return `${value} stars`;
}

function parseViewerParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    owner: params.get("owner") || "",
    repo: params.get("repo") || "",
    branch: params.get("branch") || "",
    path: normalizePath(params.get("path") || ""),
    anchor: params.get("anchor") || ""
  };
}

function buildViewerUrl(target) {
  const params = new URLSearchParams();
  params.set("owner", target.owner);
  params.set("repo", target.repo);
  if (target.branch) params.set("branch", target.branch);
  if (target.path) params.set("path", normalizePath(target.path));
  if (target.anchor) params.set("anchor", target.anchor.replace(/^#/, ""));
  return `viewer.html?${params.toString()}`;
}

function parseRepoInput(input) {
  const value = input.trim();
  if (!value) return null;

  let url = null;
  try {
    url = new URL(value);
  } catch {
    try {
      url = new URL(`https://github.com/${value.replace(/^@/, "")}`);
    } catch {
      return null;
    }
  }

  if (url.hostname !== "github.com" && url.hostname !== "raw.githubusercontent.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  if (url.hostname === "raw.githubusercontent.com") {
    return {
      owner: parts[0],
      repo: parts[1],
      branch: parts[2] || "",
      path: normalizePath(parts.slice(3).join("/")),
      anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ""
    };
  }

  const type = parts[2] || "";
  if (type === "blob" || type === "tree") {
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = detail?.message || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchGitHubHtml(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "text/html"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return {
    html: await response.text(),
    url: response.url
  };
}

function parseCount(text = "") {
  const clean = text.trim().replace(/,/g, "").toLowerCase();
  const match = clean.match(/^([\d.]+)\s*([km])?$/);
  if (!match) return NaN;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return NaN;
  if (match[2] === "m") return Math.round(value * 1000000);
  if (match[2] === "k") return Math.round(value * 1000);
  return value;
}

function parseRepoPartsFromGitHubUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

function githubPageUrl(owner, repo, branch, path, kind = "") {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const cleanPath = normalizePath(path);
  if (!cleanPath) return base;
  if (!branch) return base;
  const pageKind = kind || (isLikelyDirectory(cleanPath) ? "tree" : "blob");
  return `${base}/${pageKind}/${encodeURIComponent(branch)}/${encodePath(cleanPath)}`;
}

function rawGitHubUrl(owner, repo, branch, path) {
  if (!owner || !repo || !branch || !path) return "";
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(
    branch
  )}/${encodePath(path)}`;
}

function parseEmbeddedRepoRoute(doc) {
  for (const script of doc.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent || "";
    if (!text.includes("codeViewRepoRoute") && !text.includes("codeViewBlobRoute")) continue;

    try {
      const data = JSON.parse(text);
      const route = data?.payload?.codeViewRepoRoute || data?.payload?.codeViewBlobRoute;
      if (route) return route;
    } catch {
      // Ignore unrelated JSON script blocks.
    }
  }

  return null;
}

function readArticleFromRichText(richText) {
  if (!richText) return "";
  const doc = new DOMParser().parseFromString(richText, "text/html");
  return doc.querySelector("article.markdown-body")?.innerHTML || doc.body.innerHTML || "";
}

function cleanGitHubDescription(text = "", owner, repo) {
  return text
    .replace(new RegExp(`^GitHub\\s*-\\s*${owner}/${repo}:\\s*`, "i"), "")
    .replace(/^GitHub\s*-\s*[^:]+:\s*/i, "")
    .trim();
}

function parseRenderedGitHubPage(page, owner, repo, fallbackPath) {
  const doc = new DOMParser().parseFromString(page.html, "text/html");
  const route = parseEmbeddedRepoRoute(doc);
  const overviewFiles = route?.overview?.overviewFiles || [];
  const overviewFile =
    overviewFiles.find((file) => file.preferredFileType === "readme" && file.richText) ||
    overviewFiles.find((file) => file.richText);
  const articleHtml =
    readArticleFromRichText(route?.richText) ||
    readArticleFromRichText(overviewFile?.richText) ||
    doc.querySelector("article.markdown-body")?.innerHTML ||
    "";
  const canonical = parseRepoPartsFromGitHubUrl(page.url) || { owner, repo };
  const descriptionMeta =
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    "";
  const starsText =
    doc.querySelector(`a[href$="/stargazers"] strong`)?.textContent ||
    doc.querySelector(`a[href$="/stargazers"]`)?.textContent ||
    "";
  const branch = route?.refInfo?.name || route?.headerInfo?.refName || overviewFile?.refName || "";
  const path = normalizePath(route?.richText ? fallbackPath : overviewFile?.path || fallbackPath || "");

  return {
    articleHtml,
    blobText: readBlobText(doc),
    branch,
    path,
    repoInfo: {
      description: cleanGitHubDescription(descriptionMeta, canonical.owner, canonical.repo),
      default_branch: branch,
      stargazers_count: parseCount(starsText),
      canonical_owner: canonical.owner,
      canonical_repo: canonical.repo
    }
  };
}

function readBlobText(doc) {
  const lines = [...doc.querySelectorAll('[data-testid="code-cell"][data-line-number]')];
  if (!lines.length) return "";

  return lines
    .sort((a, b) => Number(a.getAttribute("data-line-number")) - Number(b.getAttribute("data-line-number")))
    .map((line) => line.textContent || "")
    .join("\n");
}

async function resolveRenderedDocument(owner, repo, branch, requestedPath) {
  let activeBranch = branch;
  let repoInfo = null;
  let rootParsed = null;

  if (!activeBranch || !requestedPath) {
    const rootPage = await fetchGitHubHtml(githubPageUrl(owner, repo, "", ""));
    rootParsed = parseRenderedGitHubPage(rootPage, owner, repo, "README.md");
    activeBranch = activeBranch || rootParsed.branch || "main";
    repoInfo = rootParsed.repoInfo;

    if (!requestedPath && rootParsed.articleHtml) {
      const path = rootParsed.path || "README.md";
      return {
        html: rootParsed.articleHtml,
        branch: activeBranch,
        repoInfo,
        file: {
          path,
          download_url: rawGitHubUrl(owner, repo, activeBranch, path)
        }
      };
    }
  }

  if (!requestedPath && rootParsed) {
    throw new Error("No README content was found on the GitHub page.");
  }

  const cleanPath = normalizePath(requestedPath);
  if (!isLikelyDirectory(cleanPath) && !isMarkdownPath(cleanPath)) {
    const downloadUrl = rawGitHubUrl(owner, repo, activeBranch, cleanPath);
    try {
      const text = await fetchText(downloadUrl);
      return {
        text,
        branch: activeBranch,
        repoInfo,
        file: {
          path: cleanPath,
          download_url: downloadUrl
        }
      };
    } catch {
      // Some paths are rendered by GitHub but not directly downloadable with this URL.
    }
  }

  let targetPage = null;
  let targetError = null;

  if (!requestedPath.endsWith("/")) {
    try {
      targetPage = await fetchGitHubHtml(githubPageUrl(owner, repo, activeBranch, cleanPath, "blob"));
    } catch (error) {
      targetError = error;
    }
  }

  if (!targetPage && isLikelyDirectory(cleanPath)) {
    try {
      targetPage = await fetchGitHubHtml(githubPageUrl(owner, repo, activeBranch, cleanPath, "tree"));
    } catch (error) {
      targetError = error;
    }
  }

  if (!targetPage) {
    throw targetError || new Error("Could not open this GitHub path.");
  }

  const parsed = parseRenderedGitHubPage(targetPage, owner, repo, cleanPath);
  const path =
    parsed.path ||
    (isLikelyDirectory(cleanPath) ? joinPath(cleanPath, README_CANDIDATES[0]) : cleanPath);
  const mergedRepoInfo = parsed.repoInfo?.description || parsed.repoInfo?.default_branch ? parsed.repoInfo : repoInfo;
  activeBranch = parsed.branch || activeBranch;

  if (parsed.articleHtml) {
    return {
      html: parsed.articleHtml,
      branch: activeBranch,
      repoInfo: mergedRepoInfo,
      file: {
        path,
        download_url: rawGitHubUrl(owner, repo, activeBranch, path)
      }
    };
  }

  if (parsed.blobText) {
    return {
      text: parsed.blobText,
      branch: activeBranch,
      repoInfo: mergedRepoInfo,
      file: {
        path,
        download_url: rawGitHubUrl(owner, repo, activeBranch, path)
      }
    };
  }

  if (!isLikelyDirectory(cleanPath)) {
    const downloadUrl = rawGitHubUrl(owner, repo, activeBranch, cleanPath);
    const text = await fetchText(downloadUrl);
    return {
      text,
      branch: activeBranch,
      repoInfo: mergedRepoInfo,
      file: {
        path: cleanPath,
        download_url: downloadUrl
      }
    };
  }

  throw new Error("No README file was found in this directory.");
}

function decodeBase64(content) {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

async function contentToText(file) {
  if (file.content && file.encoding === "base64") return decodeBase64(file.content);
  if (file.download_url) return fetchText(file.download_url);
  throw new Error("This file cannot be read through the GitHub API.");
}

async function fetchRepoInfo(owner, repo) {
  return fetchJson(apiUrl(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`));
}

async function fetchReadme(owner, repo, branch, dir = "") {
  const encodedDir = encodePath(normalizePath(dir));
  const readmePath = encodedDir ? `/readme/${encodedDir}` : "/readme";
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  return fetchJson(apiUrl(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${readmePath}${ref}`));
}

async function fetchContent(owner, repo, branch, path) {
  const encodedPath = encodePath(normalizePath(path));
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  return fetchJson(apiUrl(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${ref}`));
}

async function findReadmeInDirectory(owner, repo, branch, dir) {
  const listing = await fetchContent(owner, repo, branch, dir);
  if (!Array.isArray(listing)) return listing;

  const readme = listing.find((item) => README_CANDIDATES.some((name) => item.name.toLowerCase() === name.toLowerCase()));
  if (!readme) throw new Error("No README file was found in this directory.");
  return fetchContent(owner, repo, branch, readme.path);
}

async function resolveDocument(owner, repo, branch, requestedPath) {
  if (!requestedPath) {
    return fetchReadme(owner, repo, branch, "");
  }

  if (isLikelyDirectory(requestedPath)) {
    try {
      return await fetchReadme(owner, repo, branch, requestedPath);
    } catch {
      return findReadmeInDirectory(owner, repo, branch, requestedPath);
    }
  }

  const content = await fetchContent(owner, repo, branch, requestedPath);
  if (Array.isArray(content)) return findReadmeInDirectory(owner, repo, branch, requestedPath);
  return content;
}

async function renderMarkdown(markdown, context) {
  try {
    const html = await fetchText(apiUrl("/markdown"), {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        text: markdown,
        mode: "gfm",
        context: `${context.owner}/${context.repo}`
      })
    });
    return sanitizeHtml(html);
  } catch {
    return `<pre class="plain-file"><code>${escapeHtml(markdown)}</code></pre>`;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const iconAnchor of doc.querySelectorAll("a.anchor")) {
    iconAnchor.remove();
  }

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const remove = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const tag = node.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) {
      remove.push(node);
      continue;
    }

    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on") || name === "srcdoc") {
        node.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && /^(javascript|data):/i.test(value)) {
        node.removeAttribute(attr.name);
      }
    }
  }

  for (const node of remove) node.remove();
  return doc.body.innerHTML;
}

function showOnly(name) {
  els.emptyState.hidden = name !== "empty";
  els.loadingState.hidden = name !== "loading";
  els.errorState.hidden = name !== "error";
  els.document.hidden = name !== "document";
}

function updateRepoChrome() {
  const displayOwner = state.repoInfo?.canonical_owner || state.owner;
  const displayRepo = state.repoInfo?.canonical_repo || state.repo;
  const repoText = displayOwner && displayRepo ? `${displayOwner} / ${displayRepo}` : "GitHub README Wiki";
  els.repoName.textContent = repoText;
  els.repoInput.value = state.owner && state.repo ? `${state.owner}/${state.repo}` : "";
  els.heroInput.value = els.repoInput.value;

  if (state.repoInfo) {
    els.repoDescription.textContent = state.repoInfo.description || "No repository description.";
    els.repoBranch.textContent = state.branch || state.repoInfo.default_branch || "-";
    els.repoStars.textContent = humanNumber(state.repoInfo.stargazers_count);
  } else {
    els.repoDescription.textContent = "Open a GitHub repository to render its README.";
    els.repoBranch.textContent = "-";
    els.repoStars.textContent = "-";
  }

  const githubPath = state.documentInfo?.path
    ? `/blob/${encodeURIComponent(state.branch)}/${state.documentInfo.path.split("/").map(encodeURIComponent).join("/")}`
    : "";
  const githubHref =
    state.owner && state.repo ? `https://github.com/${state.owner}/${state.repo}${githubPath}` : "https://github.com";
  els.githubLink.href = githubHref;
  els.rawLink.href = state.documentInfo?.download_url || githubHref;
}

function slugifyHeading(text, used) {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-") || "section";
  let slug = base;
  let index = 1;
  while (used.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  used.add(slug);
  return slug;
}

function buildToc() {
  els.toc.textContent = "";
  const headings = [...els.document.querySelectorAll("h1, h2, h3")].slice(0, 80);
  const used = new Set([...headings].map((heading) => heading.id).filter(Boolean));

  for (const heading of headings) {
    if (!heading.id) heading.id = slugifyHeading(heading.textContent || "", used);
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.className = `depth-${Math.min(3, Number(heading.tagName.slice(1)))}`;
    link.textContent = heading.textContent || heading.id;
    item.append(link);
    els.toc.append(item);
  }
}

function normalizeGitHubHtmlLink(href) {
  return href.replace(/^https:\/\/github\.com\/users\//, "https://github.com/");
}

function parseInternalGitHubUrl(url) {
  if (url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== state.owner || parts[1] !== state.repo) return null;

  const type = parts[2] || "";
  const anchor = url.hash ? decodeURIComponent(url.hash.slice(1)) : "";
  if (!type) return { owner: state.owner, repo: state.repo, branch: state.branch, path: "", anchor };

  if (type === "blob" || type === "tree") {
    return {
      owner: state.owner,
      repo: state.repo,
      branch: parts[3] || state.branch,
      path: normalizePath(parts.slice(4).join("/")),
      anchor
    };
  }

  return null;
}

function parseInternalRawUrl(url) {
  if (url.hostname !== "raw.githubusercontent.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== state.owner || parts[1] !== state.repo) return null;
  return {
    owner: state.owner,
    repo: state.repo,
    branch: parts[2] || state.branch,
    path: normalizePath(parts.slice(3).join("/")),
    anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ""
  };
}

function targetFromRelativeHref(href) {
  const [pathPart, hashPart = ""] = href.split("#");
  if (!pathPart && hashPart) {
    return {
      owner: state.owner,
      repo: state.repo,
      branch: state.branch,
      path: state.documentInfo?.path || state.path,
      anchor: decodeURIComponent(hashPart)
    };
  }

  const baseDir = dirname(state.documentInfo?.path || state.path);
  const cleanPath = pathPart.startsWith("/")
    ? normalizePath(pathPart.slice(1))
    : joinPath(baseDir, decodeURIComponent(pathPart));

  return {
    owner: state.owner,
    repo: state.repo,
    branch: state.branch,
    path: cleanPath,
    anchor: hashPart ? decodeURIComponent(hashPart) : ""
  };
}

function viewerTargetFromHref(rawHref) {
  const href = normalizeGitHubHtmlLink(rawHref || "").trim();
  if (!href || /^(mailto|tel|javascript|data):/i.test(href)) return null;
  if (href === "#") return null;
  if (href.startsWith("/")) {
    try {
      const githubTarget = parseInternalGitHubUrl(new URL(href, "https://github.com"));
      if (githubTarget) return githubTarget;
    } catch {
      return null;
    }
  }

  if (href.startsWith("#") || href.startsWith("/") || !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return targetFromRelativeHref(href);
  }

  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  return parseInternalGitHubUrl(url) || parseInternalRawUrl(url);
}

function rawUrlForPath(path) {
  return rawGitHubUrl(state.owner, state.repo, state.branch, path);
}

function rewriteRenderedAssets() {
  for (const img of els.document.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    const target = targetFromRelativeHref(src);
    const raw = rawUrlForPath(target.path);
    if (raw) img.setAttribute("src", raw);
  }
}

function installDocumentClickHandler() {
  els.document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = viewerTargetFromHref(link.getAttribute("href"));
    if (!target) return;

    event.preventDefault();
    navigate(target);
  });

  els.toc.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (!link) return;
    event.preventDefault();
    scrollToAnchor(link.getAttribute("href").slice(1));
  });
}

function scrollToAnchor(anchor) {
  if (!anchor) return;
  const decoded = decodeURIComponent(anchor);
  const target =
    document.getElementById(decoded) ||
    document.getElementById(decoded.toLowerCase()) ||
    els.document.querySelector(`[name="${CSS.escape(decoded)}"]`);
  if (target) target.scrollIntoView({ block: "start" });
}

function submitInput(input) {
  const target = parseRepoInput(input.value);
  if (!target) {
    showError("Enter a GitHub repository like owner/repo or paste a GitHub URL.");
    return;
  }
  navigate(target);
}

function navigate(target, replace = false) {
  const url = buildViewerUrl(target);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  loadFromLocation();
}

function showError(message) {
  els.errorMessage.textContent = message;
  showOnly("error");
}

async function loadFromLocation() {
  const params = parseViewerParams();
  Object.assign(state, params, { repoInfo: null, documentInfo: null });
  updateRepoChrome();

  if (!state.owner || !state.repo) {
    document.title = "GitHub README Wiki";
    showOnly("empty");
    return;
  }

  showOnly("loading");
  els.document.textContent = "";
  els.toc.textContent = "";

  try {
    await loadRenderedFirst();
    rewriteRenderedAssets();
    buildToc();
    showOnly("document");
    window.scrollTo({ top: 0 });
    window.setTimeout(() => scrollToAnchor(state.anchor), 80);
  } catch (error) {
    updateRepoChrome();
    showError(error.message || "Unexpected error.");
  }
}

async function loadRenderedFirst() {
  try {
    const rendered = await resolveRenderedDocument(state.owner, state.repo, state.branch, state.path);
    state.branch = rendered.branch || state.branch || "main";
    state.repoInfo = rendered.repoInfo || {
      description: "",
      default_branch: state.branch,
      stargazers_count: NaN
    };
    state.documentInfo = rendered.file;

    const titlePath = rendered.file?.path || state.path || "README";
    document.title = `${state.owner}/${state.repo} - ${titlePath}`;
    updateRepoChrome();

    if (rendered.html) {
      els.document.innerHTML = sanitizeHtml(rendered.html);
      return;
    }

    if (isMarkdownPath(rendered.file?.path || state.path)) {
      els.document.innerHTML = await renderMarkdown(rendered.text || "", state);
    } else {
      els.document.innerHTML = `<pre class="plain-file"><code>${escapeHtml(rendered.text || "")}</code></pre>`;
    }
  } catch (htmlError) {
    await loadFromApiFallback(htmlError);
  }
}

async function loadFromApiFallback(originalError) {
  try {
    const repoInfo = await fetchRepoInfo(state.owner, state.repo);
    state.repoInfo = repoInfo;
    state.branch = state.branch || repoInfo.default_branch;

    const file = await resolveDocument(state.owner, state.repo, state.branch, state.path);
    const text = await contentToText(file);
    state.documentInfo = file;

    const titlePath = file.path || state.path || "README";
    document.title = `${state.owner}/${state.repo} - ${titlePath}`;
    updateRepoChrome();

    if (isMarkdownPath(file.path || state.path)) {
      els.document.innerHTML = await renderMarkdown(text, state);
    } else {
      els.document.innerHTML = `<pre class="plain-file"><code>${escapeHtml(text)}</code></pre>`;
    }
  } catch (apiError) {
    throw new Error(originalError?.message || apiError?.message || "Unexpected error.");
  }
}

function bindForms() {
  els.repoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitInput(els.repoInput);
  });

  els.heroForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitInput(els.heroInput);
  });

  for (const button of document.querySelectorAll("[data-example]")) {
    button.addEventListener("click", () => {
      const target = parseRepoInput(button.getAttribute("data-example") || "");
      if (target) navigate(target);
    });
  }

  window.addEventListener("popstate", loadFromLocation);
}

bindForms();
installDocumentClickHandler();
loadFromLocation();
