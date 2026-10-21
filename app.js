(() => {
  const $ = (id) => document.getElementById(id);
  let edits;
  try { edits = JSON.parse(localStorage.getItem("duoChatEdits") || "{}"); }
  catch { edits = {}; }
  const showText = (element, original) => {
    if (!element.isContentEditable) element.textContent = edits[element.dataset.editable] ?? original;
  };
  document.querySelectorAll("[data-editable]").forEach((element) => showText(element, element.textContent));
  document.title = edits.brand || document.title;
  document.addEventListener("dblclick", (event) => {
    const element = event.target.closest("[data-editable]");
    if (!element || element.isContentEditable) return;
    const before = element.textContent;
    element.contentEditable = "plaintext-only";
    element.focus();
    window.getSelection().selectAllChildren(element);
    const onBlur = () => finish(true);
    const onKey = (keyEvent) => {
      if (keyEvent.key === "Enter" && !keyEvent.shiftKey) { keyEvent.preventDefault(); element.blur(); }
      if (keyEvent.key === "Escape") { keyEvent.preventDefault(); finish(false); }
    };
    const finish = (save) => {
      if (!element.isContentEditable) return;
      element.removeAttribute("contenteditable");
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("keydown", onKey);
      if (!save) { element.textContent = before; return; }
      const value = element.textContent.trim().slice(0, 4000) || before;
      edits[element.dataset.editable] = value;
      localStorage.setItem("duoChatEdits", JSON.stringify(edits));
      document.querySelectorAll("[data-editable]").forEach((item) => {
        if (item.dataset.editable === element.dataset.editable) item.textContent = value;
      });
      if (element.dataset.editable === "brand") document.title = value;
    };
    element.addEventListener("blur", onBlur);
    element.addEventListener("keydown", onKey);
  });

  const config = window.CHAT_CONFIG || {};
  const linkToken = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  if (linkToken) {
    localStorage.setItem("duoChatToken", linkToken);
    history.replaceState(null, "", location.pathname + location.search);
  }
  const token = linkToken || localStorage.getItem("duoChatToken") || "";
  const input = $("messageInput");
  const list = $("messages");
  const seen = new Set();
  let mine = "";
  let latest = 0;
  let ready = false;
  let pending = false;
  let syncing = false;
  let initialized = false;
  let typingActive = false;
  let typingIdleTimer;
  let pushInitialized = false;
  let pushReady = false;

  input.placeholder = edits["composer-placeholder"] || input.placeholder;
  input.addEventListener("dblclick", () => {
    if (input.value) return;
    const value = prompt("입력창 안내 문구", input.placeholder);
    if (value?.trim()) {
      input.placeholder = value.trim().slice(0, 100);
      edits["composer-placeholder"] = input.placeholder;
      localStorage.setItem("duoChatEdits", JSON.stringify(edits));
    }
  });
  $("openMenu").onclick = () => $("sidebar").classList.add("open");
  $("settingsButton").onclick = () => { $("settings").hidden = !$("settings").hidden; };
  document.addEventListener("click", (event) => {
    if (!$("settings").contains(event.target) && !$("settingsButton").contains(event.target)) $("settings").hidden = true;
  });
  const notifyToggle = $("notifyToggle");
  notifyToggle.checked = localStorage.getItem("duoChatNotifications") !== "off";
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  notifyToggle.onchange = async () => {
    localStorage.setItem("duoChatNotifications", notifyToggle.checked ? "on" : "off");
    if (!pushSupported) return;
    if (!notifyToggle.checked) await disablePush().catch(() => notice("알림 구독을 해제하지 못했습니다."));
    else if (Notification.permission === "granted") enablePush().catch(() => notice("브라우저 알림을 설정하지 못했습니다."));
  };
  const permissionButton = $("permissionButton");
  permissionButton.onclick = async () => {
    if (!ready || !pushSupported) return notice("이 브라우저에서는 푸시 알림을 사용할 수 없습니다.");
    if (await Notification.requestPermission() !== "granted") return notice("브라우저에서 알림을 허용해주세요.");
    notifyToggle.checked = true;
    localStorage.setItem("duoChatNotifications", "on");
    try { await enablePush(); notice(""); }
    catch { notice("브라우저 알림을 설정하지 못했습니다."); }
  };
  let toastTimer;
  const notify = (message) => {
    if (!notifyToggle.checked) return;
    if ((document.hidden || !document.hasFocus()) && pushReady) return;
    if ((document.hidden || !document.hasFocus()) && "Notification" in window && Notification.permission === "granted") {
      const popup = new Notification("새 메시지", { body: message.body.slice(0, 120), icon: "./icon.svg" });
      popup.onclick = () => window.focus();
      return;
    }
    showText($("toast").querySelector(".toast-title"), "새 메시지");
    $("toastBody").textContent = message.body;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6000);
  };

  input.oninput = (event) => {
    input.style.height = "30px";
    input.style.height = Math.min(input.scrollHeight, 144) + "px";
    $("send").disabled = !ready || pending || !input.value.trim();
    if (!event.isTrusted || !ready || pending) return;
    clearTimeout(typingIdleTimer);
    const active = !!input.value.trim();
    if (typingActive !== active) setTyping(active);
    if (active) typingIdleTimer = setTimeout(() => setTyping(false), 2000);
  };
  const setTyping = (active) => {
    typingActive = active;
    rpc("chat_set_typing", { p_token: token, p_typing: active }).catch(() => {});
  };
  input.onblur = () => { clearTimeout(typingIdleTimer); if (typingActive) setTyping(false); };
  input.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("form").requestSubmit();
    }
  };
  const notice = (message) => { showText($("notice"), message); $("notice").hidden = !message; };
  const namuTopics = ["금성", "수성", "목성", "토성", "타이탄(위성)", "달", "심해", "산호", "올림푸스산(화성)", "천왕성", "해왕성", "화성", "오로라", "블랙홀", "초신성", "문어", "무지개", "번개", "화산", "빙하", "공룡", "지진"];
  const randomIndex = (length) => crypto.getRandomValues(new Uint32Array(1))[0] % length;
  const fetchNamu = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const topic = namuTopics[randomIndex(namuTopics.length)];
      const url = "https://namu.wiki/w/" + encodeURIComponent(topic);
      try {
        const response = await fetch("https://r.jina.ai/https://dark.namu.moe/w/" + encodeURIComponent(topic), { signal: AbortSignal.timeout(9000) });
        if (!response.ok) continue;
        const markdown = (await response.text()).split("Markdown Content:")[1] || "";
        const paragraphs = markdown.split(/\n\s*\n/).filter((text) =>
          text.length >= 150 && text.length <= 850 && !/^\s*[-#\[]/.test(text) && !/[{<>|]|파일:|ACL|목차|편집 보호/.test(text)
        ).map((text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/\[[^\]]*\](?:\([^)]*\))?|\*\*|https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim())
          .filter((text) => (text.match(/[가-힣]/g) || []).length > text.length * 0.35);
        const snippets = paragraphs.flatMap((text) => text.match(/[^.!?。]+[.!?。]/g) || [])
          .map((text) => text.trim()).filter((text) => text.length >= 90 && text.length <= 230
            && !/[\[\]{}<>|]/.test(text) && !/^(그리고|그러나|이에|또한|이러한|때문에|그런데)\b/.test(text)
            && !/독침|세척|치료|응급|수술|질병|사망/.test(text));
        if (!snippets.length) continue;
        const excerpt = snippets[randomIndex(snippets.length)];
        return { title: topic + "에 관한 이야기", first: excerpt, source: url };
      } catch { /* Keep the actual chat visible if the article service is unavailable. */ }
    }
    return null;
  };
  const makeFact = (id, data) => {
    const fact = document.createElement("section");
    fact.className = "fact";
    const heading = document.createElement("strong");
    heading.dataset.editable = `fact-title:${id}`;
    showText(heading, data.title);
    const paragraph = document.createElement("p");
    paragraph.dataset.editable = `fact-body:${id}:0`;
    showText(paragraph, data.first);
    const link = document.createElement("a");
    link.href = data.source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "나무위키 원문 보기";
    fact.append(heading, paragraph, link);
    return fact;
  };
  const render = (message, live = false) => {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    latest = Math.max(latest, message.id);
    $("empty")?.remove();
    const side = message.sender === mine ? "mine" : "theirs";
    const previous = $("typing").previousElementSibling;
    const row = previous?.classList.contains(side) ? previous : document.createElement("div");
    row.className = "row " + side;
    const content = document.createElement("div");
    content.className = "bubble";
    const original = document.createElement("span");
    original.dataset.editable = `message:${message.id}`;
    showText(original, message.body);
    content.append(original);
    row.append(content);
    if (!row.isConnected) list.insertBefore(row, $("typing"));
    if (side === "theirs") {
      const key = `duoNamuFact:${message.id}`;
      let cached;
      try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch { cached = null; }
      if (cached) content.after(makeFact(message.id, cached));
      else if (live) fetchNamu().then((data) => {
        if (!data) return;
        try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* Keep showing the fact. */ }
        content.after(makeFact(message.id, data));
        $("conversation").scrollTop = $("conversation").scrollHeight;
      }).catch(() => {});
    }
    $("conversation").scrollTop = $("conversation").scrollHeight;
  };
  const rpc = async (name, payload) => {
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.key, Authorization: `Bearer ${config.key}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("채팅 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
    return response.status === 204 ? null : response.json();
  };
  const enablePush = async () => {
    if (!pushSupported || !notifyToggle.checked || Notification.permission !== "granted") return;
    const registration = await navigator.serviceWorker.register("./sw.js");
    const key = config.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/");
    const applicationServerKey = Uint8Array.from(atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    if (!notifyToggle.checked) return disablePush();
    const keys = subscription.toJSON().keys;
    await rpc("chat_push_subscribe", {
      p_token: token, p_endpoint: subscription.endpoint, p_p256dh: keys.p256dh,
      p_auth: keys.auth, p_enabled: true,
    });
    pushReady = true;
    permissionButton.hidden = true;
  };
  const disablePush = async () => {
    pushReady = false;
    const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (!subscription) return;
    try {
      await rpc("chat_push_subscribe", {
        p_token: token, p_endpoint: subscription.endpoint, p_p256dh: "", p_auth: "", p_enabled: false,
      });
    } finally { await subscription.unsubscribe(); }
    permissionButton.hidden = false;
  };
  const refresh = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const result = await rpc("chat_sync", { p_token: token, p_after: latest });
      mine = result.me;
      const incoming = initialized ? result.messages.filter((message) => message.sender !== mine) : [];
      result.messages.forEach((message, index) => render(message, initialized || index >= result.messages.length - 5));
      $("typing").hidden = !result.other_typing;
      initialized = true;
      if (incoming.length) notify(incoming[incoming.length - 1]);
      ready = true;
      notice("");
      input.dispatchEvent(new Event("input"));
      if (!pushInitialized) {
        pushInitialized = true;
        if (notifyToggle.checked && pushSupported && Notification.permission === "granted") {
          enablePush().catch(() => notice("브라우저 알림을 설정하지 못했습니다."));
        }
      }
    } catch (error) {
      ready = false;
      notice(error.message);
      $("send").disabled = true;
    } finally { syncing = false; }
  };
  $("form").onsubmit = async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!ready || pending || !body) return;
    pending = true;
    $("send").disabled = true;
    try {
      clearTimeout(typingIdleTimer);
      if (typingActive) setTyping(false);
      await rpc("chat_send", { p_token: token, p_body: body });
      input.value = "";
      input.dispatchEvent(new Event("input"));
      await refresh();
    } catch (error) { notice(error.message); }
    finally { pending = false; input.dispatchEvent(new Event("input")); input.focus(); }
  };
  if (!token) notice("올바른 초대 링크로 접속해주세요.");
  else if (!config.url || !config.key) notice("채팅 서버 연결을 준비하고 있습니다.");
  else { refresh(); setInterval(refresh, 3000); setInterval(() => { if (typingActive) setTyping(true); }, 3000); }
})();
