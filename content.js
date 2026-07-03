(() => {
  const ROOT_ATTR = "data-ghrw-root";
  const ICON_ATTR = "data-ghrw-icon";
  const RESERVED_OWNERS = new Set([
    "about",
    "account",
    "apps",
    "blog",
    "codespaces",
    "collections",
    "contact",
    "dashboard",
    "enterprise",
    "events",
    "explore",
    "features",
    "gist",
    "issues",
    "join",
    "login",
    "marketplace",
    "new",
    "notifications",
    "organizations",
    "orgs",
    "pricing",
    "pulls",
    "search",
    "settings",
    "sponsors",
    "topics",
    "trending"
  ]);

  function parseRepoFromPath(pathname = window.location.pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2 || RESERVED_OWNERS.has(parts[0])) return null;

    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, ""),
      type: parts[2] || "",
      rest: parts.slice(3)
    };
  }

  function readBranchAndPath(repoInfo) {
    if (!repoInfo || !["blob", "tree"].includes(repoInfo.type)) {
      return { branch: "", path: "" };
    }

    return {
      branch: repoInfo.rest[0] || "",
      path: repoInfo.rest.slice(1).join("/")
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

  function currentViewerTarget(repoInfo) {
    return { ...repoInfo, ...readBranchAndPath(repoInfo) };
  }

  function isPlainClick(event) {
    return (
      event.button === 0 &&
      !event.defaultPrevented &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  function parseInternalGitHubUrl(url, currentRepo) {
    if (url.hostname !== "github.com") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== currentRepo.owner || parts[1] !== currentRepo.repo) return null;

    const anchor = url.hash ? decodeURIComponent(url.hash.slice(1)) : "";
    const type = parts[2] || "";
    if (!type) return { ...currentRepo, branch: "", path: "", anchor };

    if (type === "blob" || type === "tree") {
      return {
        ...currentRepo,
        branch: parts[3] || "",
        path: parts.slice(4).join("/"),
        anchor
      };
    }

    return null;
  }

  function parseInternalRawUrl(url, currentRepo) {
    if (url.hostname !== "raw.githubusercontent.com") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== currentRepo.owner || parts[1] !== currentRepo.repo) return null;

    return {
      ...currentRepo,
      branch: parts[2] || "",
      path: parts.slice(3).join("/"),
      anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ""
    };
  }

  function getViewerTargetFromHref(href, currentRepo) {
    if (!href || !currentRepo) return null;
    const trimmed = href.trim();
    if (!trimmed || /^(mailto|tel|javascript|data):/i.test(trimmed)) return null;

    const currentFile = readBranchAndPath(currentRepo);
    if (trimmed.startsWith("#")) {
      return { ...currentRepo, ...currentFile, anchor: trimmed.slice(1) };
    }

    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      const [pathPart, anchor = ""] = trimmed.split("#");
      if (trimmed.startsWith("/")) {
        try {
          const githubTarget = parseInternalGitHubUrl(new URL(trimmed, "https://github.com"), currentRepo);
          if (githubTarget) return githubTarget;
        } catch {
          return null;
        }
      }

      const baseDir = currentFile.path.includes("/")
        ? currentFile.path.slice(0, currentFile.path.lastIndexOf("/"))
        : "";
      const path = pathPart.startsWith("/")
        ? pathPart.slice(1)
        : [baseDir, pathPart].filter(Boolean).join("/");
      return {
        ...currentRepo,
        branch: currentFile.branch,
        path,
        anchor
      };
    }

    let url;
    try {
      url = new URL(trimmed, window.location.href);
    } catch {
      return null;
    }

    return parseInternalGitHubUrl(url, currentRepo) || parseInternalRawUrl(url, currentRepo);
  }

  function injectEntry() {
    const repoInfo = parseRepoFromPath();
    if (!repoInfo) return;

    const existing = document.querySelector(`[${ROOT_ATTR}]`);
    if (existing) {
      existing.querySelector("a").href = buildViewerUrl(currentViewerTarget(repoInfo));
      return;
    }

    const readmeArticle =
      document.querySelector("[data-testid='readme']") ||
      document.querySelector("article.markdown-body") ||
      document.querySelector(".repository-content");
    if (!readmeArticle) return;

    const entry = document.createElement("div");
    entry.className = "ghrw-entry";
    entry.setAttribute(ROOT_ATTR, "true");

    const link = document.createElement("a");
    link.className = "ghrw-entry__button";
    link.href = buildViewerUrl(currentViewerTarget(repoInfo));
    link.textContent = "Open README Wiki";

    const mark = document.createElement("span");
    mark.className = "ghrw-entry__mark";
    mark.setAttribute("aria-hidden", "true");
    link.prepend(mark);

    entry.append(link);

    const box = readmeArticle.closest(".Box") || readmeArticle;
    box.parentNode.insertBefore(entry, box);
  }

  function makeIconLink(repoInfo, className) {
    const link = document.createElement("a");
    link.className = className;
    link.href = buildViewerUrl(currentViewerTarget(repoInfo));
    link.title = "Open README Wiki";
    link.setAttribute("aria-label", "Open README Wiki");
    link.innerHTML = `
      <span class="ghrw-icon__glyph" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
    `;
    return link;
  }

  function findToolbarHost() {
    const candidates = [
      "#repository-container-header ul.pagehead-actions",
      "ul.pagehead-actions",
      "[data-testid='repository-actions']",
      ".Layout-sidebar .BorderGrid",
      "[data-hpc] .d-flex.flex-items-center.gap-2"
    ];

    for (const selector of candidates) {
      const element = document.querySelector(selector);
      if (element) return element;
    }

    return null;
  }

  function injectIcon() {
    const repoInfo = parseRepoFromPath();
    if (!repoInfo) return;

    const existing = document.querySelector(`[${ICON_ATTR}]`);
    if (existing) {
      const link = existing.matches("a") ? existing : existing.querySelector("a");
      if (link) link.href = buildViewerUrl(currentViewerTarget(repoInfo));
      return;
    }

    const host = findToolbarHost();
    if (host?.tagName === "UL") {
      const item = document.createElement("li");
      item.className = "ghrw-toolbar-item";
      item.setAttribute(ICON_ATTR, "true");
      item.append(makeIconLink(repoInfo, "ghrw-icon-button ghrw-icon-button--toolbar"));
      host.prepend(item);
      return;
    }

    if (host) {
      const item = document.createElement("div");
      item.className = "ghrw-toolbar-item";
      item.setAttribute(ICON_ATTR, "true");
      item.append(makeIconLink(repoInfo, "ghrw-icon-button ghrw-icon-button--toolbar"));
      host.prepend(item);
      return;
    }

    const floating = makeIconLink(repoInfo, "ghrw-icon-button ghrw-icon-button--floating");
    floating.setAttribute(ICON_ATTR, "true");
    document.body.append(floating);
  }

  function interceptReadmeLinks() {
    document.addEventListener(
      "click",
      (event) => {
        if (!isPlainClick(event)) return;

        const link = event.target.closest("a[href]");
        if (!link) return;

        const inReadme =
          link.closest("[data-testid='readme']") ||
          link.closest("article.markdown-body") ||
          link.closest(".ghrw-entry") ||
          link.closest(`[${ICON_ATTR}]`);
        if (!inReadme) return;

        const repoInfo = parseRepoFromPath();
        const target = getViewerTargetFromHref(link.getAttribute("href"), repoInfo);
        if (!target) return;

        event.preventDefault();
        window.location.assign(buildViewerUrl(target));
      },
      true
    );
  }

  function boot() {
    injectEntry();
    injectIcon();
    interceptReadmeLinks();

    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        window.setTimeout(() => {
          injectEntry();
          injectIcon();
        }, 120);
      } else if (!document.querySelector(`[${ROOT_ATTR}]`)) {
        injectEntry();
      } else if (!document.querySelector(`[${ICON_ATTR}]`)) {
        injectIcon();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();
