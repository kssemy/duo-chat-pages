(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.CHAT_CONFIG || {};
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  let mine = "";
  const input = $("messageInput");
  const list = $("messages");
  const seen = new Set();
  const metas = new Map();
  let latest = 0;
  let pending = false;
  let ready = false;

  $("openMenu").onclick = () => $("sidebar").classList.add("open");
  $("closeMenu").onclick = () => $("sidebar").classList.remove("open");
  input.oninput = () => {
    input.style.height = "36px";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
    $("send").disabled = !ready || pending || !input.value.trim();
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("form").requestSubmit();
    }
  };
  const notice = (message) => { $("notice").textContent = message; $("notice").hidden = !message; };
  const status = (ok, message) => {
    $("statusDot").classList.toggle("off", !ok);
    $("statusText").textContent = message;
  };
  const displayTime = (value) => new Date(value).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  const render = (message) => {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    latest = Math.max(latest, message.id);
    $("empty")?.remove();
    const row = document.createElement("div");
    row.className = "row " + (message.sender === mine ? "mine" : "theirs");
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.body;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (message.sender === mine ? "나" : "상대방") + " · " + displayTime(message.created_at);
    if (message.sender === mine) metas.set(message.id, meta);
    row.append(bubble, meta);
    list.append(row);
    $("conversation").scrollTop = $("conversation").scrollHeight;
  };
  const rpc = async (name, payload) => {
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.key, Authorization: `Bearer ${config.key}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("채팅 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
    return response.json();
  };
  const refresh = async () => {
    try {
      const result = await rpc("chat_sync", { p_token: token, p_after: latest });
      mine = result.me;
      $("profileName").textContent = mine === "owner" ? "나" : "상대방";
      $("avatar").textContent = mine === "owner" ? "나" : "상";
      result.messages.forEach(render);
      for (const [id, meta] of metas) {
        const label = meta.textContent.replace(/ · 읽음$/, "");
        meta.textContent = label + (id <= result.other_read ? " · 읽음" : "");
      }
      ready = true;
      status(true, "연결됨");
      notice("");
      input.dispatchEvent(new Event("input"));
    } catch (error) {
      ready = false;
      status(false, "연결 끊김");
      notice(error.message);
      $("send").disabled = true;
    }
  };
  $("form").onsubmit = async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!ready || pending || !body) return;
    pending = true;
    $("send").disabled = true;
    try {
      await rpc("chat_send", { p_token: token, p_body: body });
      input.value = "";
      input.dispatchEvent(new Event("input"));
      await refresh();
    } catch (error) { notice(error.message); }
    finally { pending = false; input.dispatchEvent(new Event("input")); input.focus(); }
  };
  if (!token) notice("올바른 초대 링크로 접속해주세요.");
  else if (!config.url || !config.key) notice("새 Supabase 프로젝트 연결을 준비하고 있습니다.");
  else {
    refresh();
    setInterval(refresh, 3000);
  }
})();
