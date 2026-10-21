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
  const fillers = [
    "이 부분도 같이 봐주세요.", "조금 더 자세히 알려주세요.", "관련된 내용도 확인 부탁드려요.",
    "가능한 방법을 알려주시면 좋겠어요.", "전체 흐름도 함께 설명해 주세요.", "필요한 부분만 간단히 짚어주세요.",
    "이어서 생각해 볼 점도 알려주세요.", "자연스럽게 정리해 주시면 좋겠습니다.", "앞의 내용과 연결해서 살펴봐 주세요.",
    "이 경우에 주의할 점이 있다면 덧붙여 주세요.", "가능하면 몇 가지 예시도 함께 들어주세요.", "제가 이해하기 쉽게 차근차근 풀어주세요.",
    "실제로 적용할 때 어떤 순서가 좋을지도 궁금해요.", "비슷한 상황에서는 어떻게 달라지는지도 알려주세요.", "핵심부터 설명하고 세부 사항도 이어서 알려주세요.",
    "앞에서 말한 조건을 고려해서 다시 한번 정리해 주세요.", "이 내용에 맞는 표현이나 방법이 있다면 추천해 주세요.", "조금 더 자연스럽고 읽기 편한 방향으로 다듬어 주세요.",
    "놓치기 쉬운 부분이 있으면 함께 확인하고 싶습니다.", "전체적인 맥락을 보면서 필요한 내용까지 이어서 설명해 주세요.", "장단점이 있다면 짧게 비교한 뒤 적절한 쪽을 알려주세요.",
    "지금 이야기한 내용에 이어서 다음 단계도 함께 생각해 주세요.", "가능한 선택지를 살펴보고 각각 어떤 차이가 있는지 알려주세요.", "너무 복잡하지 않게 설명하되 중요한 부분은 빠뜨리지 말아주세요.",
    "제가 바로 이해할 수 있도록 쉬운 말로 풀어서 설명해 주시면 좋겠어요.", "이 방향이 괜찮은지 확인하고, 더 나은 표현이 있다면 함께 제안해 주세요.", "앞뒤 문맥이 자연스럽게 이어지도록 필요한 내용을 조금 더 보태서 설명해 주세요.",
    "우선 핵심 내용을 정리한 다음에, 실제로 어떻게 진행하면 좋을지도 알려주세요.", "관련된 예시를 하나 들어서 설명해 주시고, 상황에 따라 달라지는 부분도 짚어주세요.", "지금까지 이야기한 조건을 모두 반영해서, 이해하기 쉬운 순서로 조금 더 자세히 정리해 주세요."
  ];
  const render = (message) => {
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
    const index = Math.abs((Number(message.id) * 2654435761) | 0) % fillers.length;
    content.append(document.createTextNode(" " + fillers[index]));
    row.append(content);
    if (!row.isConnected) list.insertBefore(row, $("typing"));
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
      result.messages.forEach(render);
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
