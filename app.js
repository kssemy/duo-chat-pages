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
  const facts = [
    ["금성의 하루는 1년보다 길다", "금성이 자전 한 번을 마치는 데는 지구 시간으로 약 243일이 걸립니다. 태양 주위를 한 바퀴 도는 데 걸리는 약 225일보다 더 길죠.", "그래서 금성에서는 달력의 1년이 지나도 자전 기준으로는 하루가 채 지나지 않습니다. 우리가 익숙한 하루와 1년의 순서가 뒤집힌 셈입니다.", "https://science.nasa.gov/venus/venus-facts/"],
    ["금성의 태양은 서쪽에서 뜬다", "금성은 대부분의 행성과 반대 방향으로 천천히 자전합니다. 금성 표면에서 태양을 볼 수 있다면 서쪽에서 떠서 동쪽으로 지는 것처럼 보입니다.", "물론 실제 표면은 엄청난 열과 압력 때문에 사람에게 매우 위험합니다. 익숙한 지구의 하늘을 그대로 떠올리면 가장 먼저 어긋나는 장면이 바로 일출 방향입니다.", "https://science.nasa.gov/venus/venus-facts/"],
    ["태양에 더 가까운 수성보다 금성이 뜨겁다", "금성은 수성보다 태양에서 멀지만 태양계에서 표면이 가장 뜨거운 행성입니다. 두꺼운 대기가 열을 붙잡는 강한 온실 효과 때문입니다.", "행성의 온도는 태양까지의 거리만으로 정해지지 않습니다. 어떤 대기를 가졌는지도 결정적인 역할을 한다는 극단적인 예입니다.", "https://science.nasa.gov/venus/venus-facts/"],
    ["수성의 낮과 밤은 놀랄 만큼 길다", "수성의 자전 주기는 지구 시간으로 약 59일입니다. 하지만 하늘에서 태양이 다시 같은 자리로 돌아오는 하루는 약 176일이나 걸립니다.", "자전과 공전이 함께 작용하기 때문입니다. 지구처럼 한 번 회전하면 곧바로 다음 날이 되는 감각으로는 설명하기 어려운 하늘입니다.", "https://science.nasa.gov/mercury/facts/"],
    ["가장 안쪽 행성에도 얼음이 있다", "수성은 태양과 가장 가까운 행성이지만, 극지의 깊은 분화구에는 햇빛이 닿지 않는 곳이 있습니다. 그늘진 바닥에는 물 얼음이 보존될 만큼 낮은 온도가 유지될 수 있습니다.", "같은 행성 안에서도 햇볕을 받는 곳과 영원한 그늘의 환경이 크게 다릅니다. 태양 가까이에 있다고 모든 곳이 뜨거운 것은 아닙니다.", "https://science.nasa.gov/mercury/facts/"],
    ["수성에는 달도 고리도 없다", "태양계의 행성은 모두 달을 가진 것처럼 느껴지지만 수성에는 자연 위성이 없습니다. 토성처럼 눈에 띄는 고리도 없죠.", "가까운 금성 역시 달이 없는 행성입니다. 행성마다 크기, 궤도, 형성 과정이 달라 주변에 남은 천체의 모습도 다릅니다.", "https://science.nasa.gov/mercury/facts/"],
    ["목성의 하루는 약 10시간", "목성은 태양계에서 가장 큰 행성이지만 자전은 가장 빠릅니다. 한 번 회전하는 데 지구 시간으로 약 9.9시간이 걸립니다.", "거대한 몸집과 빠른 회전이 만나 대기에는 길게 뻗은 줄무늬와 강한 바람이 나타납니다. 큰 행성이라 느리게 돌 것이라는 예상과 정반대입니다.", "https://science.nasa.gov/jupiter/jupiter-facts/"],
    ["목성의 대적점은 오래된 폭풍이다", "목성의 붉은 타원인 대적점은 지구보다 큰 거대한 폭풍입니다. 수백 년 동안 관측되어 왔지만 모양과 크기는 계속 변합니다.", "지구의 태풍은 육지와 만나며 약해질 수 있지만 목성에는 같은 방식의 단단한 표면이 없습니다. 가스 행성의 폭풍이 얼마나 다른지 보여주는 사례입니다.", "https://science.nasa.gov/jupiter/jupiter-facts/"],
    ["목성의 얼음 위성 아래에는 바다가 있을지 모른다", "목성의 위성 유로파는 겉이 얼음으로 덮여 있습니다. 관측 결과는 그 아래에 거대한 액체 바다가 있을 가능성을 보여줍니다.", "얼음 아래의 바다는 햇빛이 거의 닿지 않는 환경일 텐데, 그래서 연구자들은 그곳의 물과 에너지원에 주목합니다. 아직 생명체를 발견했다는 뜻은 아닙니다.", "https://science.nasa.gov/jupiter/jupiter-facts/"],
    ["토성은 물보다 밀도가 낮다", "토성의 평균 밀도는 물보다 낮습니다. 행성을 담을 만큼 거대한 물통이 실제로 존재한다면 토성이 뜰 수 있다는 비유가 나오는 이유입니다.", "물론 그런 물통은 만들 수 없고, 실제 토성은 기체와 유체가 복잡하게 층을 이룹니다. 이 비유는 토성이 부피에 비해 얼마나 가벼운지 알려줍니다.", "https://science.nasa.gov/mission/cassini/faq/"],
    ["토성의 고리는 한 장의 판이 아니다", "멀리서 보면 매끈한 원반처럼 보이지만 토성의 고리는 얼음 조각, 먼지, 암석 파편이 각각 토성을 도는 거대한 무리입니다.", "입자마다 궤도가 조금씩 다르고, 가까운 위성의 중력이 빈틈과 무늬를 만듭니다. 사진 한 장에 담긴 고리가 사실은 수많은 독립적인 움직임인 셈입니다.", "https://science.nasa.gov/mission/cassini/faq/"],
    ["거대한 토성 고리는 의외로 얇다", "토성의 주요 고리는 옆으로 엄청나게 넓게 퍼져 있지만 두께는 일부 영역에서 수십 미터 이하로 추정됩니다.", "엄청난 너비와 얇은 두께의 차이 때문에, 멀리서 보는 각도에 따라 고리가 매우 가늘게 보이기도 합니다. 우주 규모에서는 종잇장 같은 구조입니다.", "https://science.nasa.gov/mission/cassini/faq/"],
    ["타이탄에는 메탄 비가 내린다", "토성의 위성 타이탄에는 구름, 비, 강, 호수와 바다가 있습니다. 다만 지구의 물 대신 액체 메탄과 에탄이 그 순환을 이룹니다.", "지형을 깎는 액체가 있다는 점은 지구와 닮았지만 재료와 온도는 완전히 다릅니다. 익숙한 풍경이 낯선 화학으로 만들어진 세계입니다.", "https://science.nasa.gov/saturn/moons/titan/facts/"],
    ["타이탄의 하늘은 두꺼운 대기에 가려져 있다", "타이탄은 위성인데도 두꺼운 대기를 지녔습니다. 그 대기는 주로 질소로 이루어져 있고, 짙은 안개가 표면을 가립니다.", "우주선이 가까이 가도 표면을 평범한 사진으로는 보기 어려웠습니다. 레이더 관측 덕분에 강과 호수 같은 지형을 더 자세히 알게 되었습니다.", "https://science.nasa.gov/saturn/moons/titan/facts/"],
    ["타이탄은 수성보다 크다", "타이탄은 토성의 위성이지만 지름은 행성 수성보다 큽니다. 태양계 위성 중에서는 목성의 가니메데 다음으로 큰 편입니다.", "하지만 크다고 행성이 되는 것은 아닙니다. 무엇을 중심으로 도는지가 분류에서 중요합니다. 타이탄은 토성을 돌기 때문에 위성입니다.", "https://science.nasa.gov/saturn/moons/titan/facts/"],
    ["인류는 1959년에야 달의 뒷면을 봤다", "달은 자전 주기와 지구를 도는 주기가 거의 같아 지구에서는 늘 비슷한 면을 보게 됩니다. 달의 반대편은 1959년 우주선이 지나가며 처음 사진으로 확인했습니다.", "'달의 뒷면'은 영원히 어두운 면이라는 뜻이 아닙니다. 그쪽에도 햇빛은 들지만 지구에서 직접 보이지 않을 뿐입니다.", "https://science.nasa.gov/moon/facts/"],
    ["달의 발자국은 오래 남는다", "달에는 지구처럼 바람과 비가 거의 없습니다. 그래서 아폴로 우주인이 남긴 이동 흔적은 수십 년이 지나도 달 표면에서 관측됩니다.", "물론 영원히 완벽하게 보존되는 것은 아닙니다. 작은 우주 물질의 충돌 등은 계속 일어나지만, 지구의 발자국보다 훨씬 오래 남을 수 있습니다.", "https://science.nasa.gov/solar-system/moon/10-cool-things-nasas-lunar-reconnaissance-orbiter-is-teaching-us-about-the-moon/"],
    ["달의 '바다'에는 물이 없다", "달 표면의 어두운 평야는 오래전부터 '바다'라고 불렸습니다. 옛 관측자들이 어두운 부분을 실제 바다로 생각했기 때문입니다.", "지금은 그곳이 과거 화산 활동으로 생긴 현무암 평야임을 압니다. 이름은 남았지만 의미는 새 지식에 맞춰 달라진 흥미로운 사례입니다.", "https://science.nasa.gov/moon/moon-water-and-ices/"],
    ["달의 극지에는 얼음의 흔적이 있다", "달은 대기가 희박하고 낮 동안 뜨겁지만, 극지의 깊은 분화구에는 영구적으로 그늘진 곳이 있습니다. 여러 관측은 이 지역에 얼어 있는 물이 있음을 가리킵니다.", "미래의 달 탐사에서는 이 물을 식수나 산소, 연료 원료로 활용할 가능성이 연구됩니다. 어디에 얼마나 있는지는 계속 조사 중입니다.", "https://science.nasa.gov/solar-system/moon/10-cool-things-nasas-lunar-reconnaissance-orbiter-is-teaching-us-about-the-moon/"],
    ["바다의 평균 깊이는 약 3.7킬로미터", "바다의 평균 깊이는 약 3,682미터로 추정됩니다. 하지만 해저는 평평한 바닥이 아니라 산과 골짜기가 뒤섞인 복잡한 지형입니다.", "위성은 바다 표면의 미세한 변화를 통해 해저를 추정하기도 합니다. 직접 고해상도로 측정한 해저 지형은 아직 바다 전체의 일부입니다.", "https://oceanexplorer.noaa.gov/ocean-fact/ocean-depth/"],
    ["바다에서 가장 깊은 곳은 어디일까", "태평양 마리아나 해구의 챌린저 해연은 약 10,935미터 깊이로 알려져 있습니다. 높이 8,849미터인 에베레스트산을 넣어도 위에 물이 남습니다.", "이 정도 깊이에서는 엄청난 수압 때문에 탐사 장비를 설계하기가 어렵습니다. 깊은 바다는 가까운 지구 안에 있으면서도 조사하기 힘든 환경입니다.", "https://oceanexplorer.noaa.gov/ocean-fact/ocean-depth/"],
    ["심해에는 스스로 빛나는 생물이 많다", "해양 생물 일부는 몸속 화학 반응으로 빛을 만듭니다. 특히 햇빛이 약한 깊이의 물기둥에서는 생물 발광이 흔합니다.", "빛은 먹이를 찾거나 상대를 알아보거나 포식자를 피하는 데 쓰일 수 있습니다. 완전히 어두워 보이는 바다에도 생물이 만든 신호가 오가는 셈입니다.", "https://oceanexplorer.noaa.gov/ocean-fact/bioluminescence/"],
    ["심해 생물의 빛은 왜 푸른색이 많을까", "바닷물에서는 푸른 계열의 빛이 비교적 잘 전달됩니다. 그래서 많은 발광 생물이 파란빛을 내지만, 녹색이나 드물게 붉은빛을 내는 경우도 있습니다.", "같은 '빛'이어도 색에 따라 물속에서 퍼지는 거리가 달라집니다. 생물이 살아가는 환경이 신호의 색에도 영향을 준다는 점이 재미있습니다.", "https://oceanexplorer.noaa.gov/ocean-fact/bioluminescence/"],
    ["심해 새우는 빛을 뿜어 방어하기도 한다", "일부 심해 새우는 위험을 만나면 발광 물질을 몸 밖으로 내보냅니다. 포식자의 시선을 흐트러뜨리는 데 도움이 될 수 있습니다.", "육지에서 먹물을 뿜는 문어를 떠올리면 이해하기 쉽습니다. 다만 여기서는 어둠 속에 갑자기 빛나는 흔적을 남긴다는 차이가 있습니다.", "https://oceanexplorer.noaa.gov/ocean-fact/bioluminescence/"],
    ["소리는 물속에서 더 빨리 간다", "소리는 공기에서 초속 약 340미터로 이동하지만 바닷물에서는 보통 초속 약 1,500미터로 움직입니다.", "온도와 압력, 염분에 따라 실제 속도는 달라집니다. 고래와 다른 해양 동물이 소리를 이용해 멀리 있는 상대와 소통할 수 있는 이유 중 하나입니다.", "https://oceanservice.noaa.gov/facts/sound.html"],
    ["바다에는 소리의 통로가 있다", "바다의 온도와 압력이 깊이에 따라 달라지면 소리의 진행 방향도 휘어집니다. 특정 깊이에서는 소리가 위아래로 굴절되며 멀리까지 전달됩니다.", "이런 자연적인 소리 통로를 SOFAR 채널이라고 부릅니다. 바다 한가운데에서 난 소리가 아주 먼 거리까지 전해질 수 있습니다.", "https://oceanservice.noaa.gov/facts/sofar.html"],
    ["산호는 식물이 아니라 동물이다", "산호는 바닥에 붙어 있어서 식물이나 돌처럼 보이지만 동물입니다. 우리가 보는 산호 한 덩어리는 작은 폴립이 모여 이룬 군체인 경우가 많습니다.", "폴립은 촉수로 먹이를 잡고 단단한 골격을 만듭니다. 고요해 보이는 산호초가 사실은 살아 있는 수많은 개체의 집합입니다.", "https://oceanexplorer.noaa.gov/ocean-fact/coral-animal/"],
    ["산호와 조류는 서로 돕는다", "많은 산호는 몸속의 작은 조류와 함께 삽니다. 조류는 빛을 이용해 만든 에너지를 산호에 제공하고, 산호는 조류가 머물 곳을 내줍니다.", "바닷물이 너무 뜨거워지는 등 스트레스를 받으면 산호가 조류를 내보낼 수 있습니다. 이때 하얗게 보이는 현상이 산호 백화입니다.", "https://oceanservice.noaa.gov/facts/coral.html"],
    ["어떤 산호는 수천 년을 산다", "산호의 나이를 세는 방식은 단순하지 않지만, 일부 산호 군체나 같은 유전적 계통은 수천 년에 걸쳐 이어질 수 있습니다.", "아주 오래 산다고 환경 변화에 무조건 강한 것은 아닙니다. 바다의 온도와 상태가 급격히 달라지면 오래된 산호도 심한 영향을 받습니다.", "https://oceanexplorer.noaa.gov/ocean-fact/how-long-can-corals-live/"],
    ["화성에는 거대한 화산이 있다", "화성의 올림푸스산은 태양계에서 가장 거대한 화산 가운데 하나입니다. 높이는 에베레스트산의 몇 배에 이릅니다.", "화성에서는 지구와 같은 판 구조 운동이 없어서 화산이 한자리에서 오랫동안 커질 수 있었다고 설명합니다. 지구의 산과 같은 눈높이로 상상하기 어려운 규모입니다.", "https://science.nasa.gov/resource/grand-canyons-of-earth-and-mars/"]
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
    const [title, first, second, source] = facts[(Math.imul(Number(message.id), 2654435761) >>> 0) % facts.length];
    const fact = document.createElement("section");
    fact.className = "fact";
    const heading = document.createElement("strong");
    heading.dataset.editable = `fact-title:${message.id}`;
    showText(heading, title);
    const paragraphs = [first, second].map((text, index) => {
      const paragraph = document.createElement("p");
      paragraph.dataset.editable = `fact-body:${message.id}:${index}`;
      showText(paragraph, text);
      return paragraph;
    });
    const link = document.createElement("a");
    link.href = source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "출처: " + (source.includes("nasa.gov") ? "NASA" : "NOAA");
    const wikiTopic = source.includes("venus") ? "금성"
      : source.includes("mercury") ? "수성"
      : source.includes("jupiter") ? "목성"
      : source.includes("titan") ? "타이탄(위성)"
      : source.includes("saturn") || source.includes("cassini") ? "토성"
      : source.includes("moon") || source.includes("lunar") ? "달"
      : source.includes("coral") ? "산호"
      : source.includes("mars") ? "올림푸스산(화성)" : "심해";
    const wiki = document.createElement("a");
    wiki.href = "https://namu.wiki/w/" + encodeURIComponent(wikiTopic);
    wiki.target = "_blank";
    wiki.rel = "noopener noreferrer";
    wiki.textContent = " · 나무위키 관련 문서";
    fact.append(heading, ...paragraphs, link, wiki);
    row.append(content, fact);
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
