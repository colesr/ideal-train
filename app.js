const NETWORKS = {
  base: {
    label: "Base",
    chainIdHex: "0x2105",
    rpcBaseUrl: "https://api-base.reservoir.tools",
    explorer: "https://basescan.org",
    nativeSymbol: "ETH"
  },
  ethereum: {
    label: "Ethereum",
    chainIdHex: "0x1",
    rpcBaseUrl: "https://api.reservoir.tools",
    explorer: "https://etherscan.io",
    nativeSymbol: "ETH"
  }
};

const state = {
  network: localStorage.getItem("nftTradeRadar.network") || "base",
  apiKey: localStorage.getItem("nftTradeRadar.apiKey") || "",
  collectionAddress: localStorage.getItem("nftTradeRadar.collection") || "",
  account: "",
  collection: null,
  tokens: [],
  signals: [],
  prediction: null,
  isLoading: false
};

const elements = {
  form: document.getElementById("analysis-form"),
  connectWalletButton: document.getElementById("connect-wallet"),
  clearButton: document.getElementById("clear-dashboard"),
  walletStatus: document.getElementById("wallet-status"),
  activeNetwork: document.getElementById("active-network"),
  networkSelect: document.getElementById("network-select"),
  collectionInput: document.getElementById("collection-input"),
  apiKeyInput: document.getElementById("api-key-input"),
  message: document.getElementById("app-message"),
  collectionTitle: document.getElementById("collection-title"),
  collectionBadge: document.getElementById("collection-badge"),
  metricsGrid: document.getElementById("metrics-grid"),
  predictionTitle: document.getElementById("prediction-title"),
  confidencePill: document.getElementById("confidence-pill"),
  predictionSummary: document.getElementById("prediction-summary"),
  signalList: document.getElementById("signal-list"),
  ownedTokens: document.getElementById("owned-tokens")
};

initialize();

async function initialize() {
  hydrateInputs();
  bindEvents();
  render();
  await restoreWalletSession();
}

function hydrateInputs() {
  elements.networkSelect.value = state.network;
  elements.collectionInput.value = state.collectionAddress;
  elements.apiKeyInput.value = state.apiKey;
}

function bindEvents() {
  elements.connectWalletButton.addEventListener("click", connectWallet);
  elements.clearButton.addEventListener("click", resetDashboard);
  elements.form.addEventListener("submit", handleAnalyzeSubmit);
  elements.networkSelect.addEventListener("change", handleNetworkChange);
  elements.collectionInput.addEventListener("input", persistDraftValues);
  elements.apiKeyInput.addEventListener("input", persistDraftValues);

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);
  }
}

async function restoreWalletSession() {
  if (!window.ethereum) {
    setMessage("MetaMask-compatible wallet not detected. You can still inspect collection stats without connecting.", "error");
    render();
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts.length > 0) {
      state.account = accounts[0];
      syncWalletStatus();
      render();
    }
  } catch (error) {
    console.error(error);
    setMessage("Unable to restore wallet session automatically.", "error");
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setMessage("MetaMask-compatible wallet not found in this browser.", "error");
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts.length) {
      setMessage("No wallet account was returned.", "error");
      return;
    }

    state.account = accounts[0];
    syncWalletStatus();
    render();
    await ensureSelectedChain();
    setMessage("Wallet connected. Run an analysis to load collection data and matching NFTs.", "success");
  } catch (error) {
    console.error(error);
    setMessage(getReadableWalletError(error), "error");
  }
}

async function ensureSelectedChain() {
  if (!window.ethereum) {
    return;
  }

  const selectedNetwork = NETWORKS[state.network];

  try {
    const currentChainId = await window.ethereum.request({ method: "eth_chainId" });
    if (currentChainId === selectedNetwork.chainIdHex) {
      return;
    }

    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: selectedNetwork.chainIdHex }]
    });
  } catch (error) {
    console.error(error);
    if (state.network === "base" && error && error.code === 4902) {
      await addBaseNetwork();
      return;
    }
    throw error;
  }
}

async function addBaseNetwork() {
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: NETWORKS.base.chainIdHex,
      chainName: "Base",
      nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18
      },
      rpcUrls: ["https://mainnet.base.org"],
      blockExplorerUrls: ["https://basescan.org"]
    }]
  });
}

function handleAccountsChanged(accounts) {
  state.account = accounts[0] || "";
  syncWalletStatus();
  renderOwnedTokens();
}

function handleChainChanged(chainId) {
  const matchingNetwork = Object.entries(NETWORKS).find(([, value]) => value.chainIdHex === chainId);
  if (matchingNetwork) {
    state.network = matchingNetwork[0];
    hydrateInputs();
    persistDraftValues();
    render();
  }
}

async function handleAnalyzeSubmit(event) {
  event.preventDefault();

  const collectionAddress = elements.collectionInput.value.trim();
  if (!isAddress(collectionAddress)) {
    setMessage("Enter a valid EVM collection contract address.", "error");
    return;
  }

  state.collectionAddress = collectionAddress;
  state.apiKey = elements.apiKeyInput.value.trim();
  persistDraftValues();

  if (state.account) {
    try {
      await ensureSelectedChain();
    } catch (error) {
      setMessage(`Wallet network mismatch: ${getReadableWalletError(error)}`, "error");
      return;
    }
  }

  state.isLoading = true;
  render();
  setMessage("Loading collection stats and wallet NFTs...", "neutral");

  try {
    const [collectionData, tokenData] = await Promise.all([
      fetchCollectionData(collectionAddress),
      state.account ? fetchOwnedTokens(state.account, collectionAddress) : Promise.resolve([])
    ]);

    state.collection = collectionData;
    state.tokens = tokenData;
    state.signals = buildSignals(collectionData);
    state.prediction = buildPrediction(state.signals);
    state.isLoading = false;

    setMessage("Analysis complete. Review the signals before making a trade decision.", "success");
    render();
  } catch (error) {
    console.error(error);
    state.isLoading = false;
    state.collection = null;
    state.tokens = [];
    state.signals = [];
    state.prediction = null;
    render();
    setMessage(error.message || "Unable to load NFT market data for that collection.", "error");
  }
}

function handleNetworkChange(event) {
  state.network = event.target.value;
  persistDraftValues();
  render();
}

function persistDraftValues() {
  state.collectionAddress = elements.collectionInput.value.trim();
  state.apiKey = elements.apiKeyInput.value.trim();
  localStorage.setItem("nftTradeRadar.network", state.network);
  localStorage.setItem("nftTradeRadar.collection", state.collectionAddress);
  localStorage.setItem("nftTradeRadar.apiKey", state.apiKey);
}

function resetDashboard() {
  state.collection = null;
  state.tokens = [];
  state.signals = [];
  state.prediction = null;
  state.collectionAddress = "";
  elements.collectionInput.value = "";
  localStorage.removeItem("nftTradeRadar.collection");
  setMessage("Dashboard reset. Enter another collection contract to analyze.", "neutral");
  render();
}

async function fetchCollectionData(collectionAddress) {
  const data = await fetchJson(`${getApiBaseUrl()}/collections/v5?id=${encodeURIComponent(collectionAddress)}`);
  const rawCollection = Array.isArray(data.collections) ? data.collections[0] : data.collection;

  if (!rawCollection) {
    throw new Error("No collection data was returned by the selected market-data provider.");
  }

  const tokenCount = getNumber(rawCollection, [
    ["tokenCount"],
    ["supply"],
    ["tokensCount"]
  ]);
  const ownerCount = getNumber(rawCollection, [
    ["ownerCount"],
    ["owners"]
  ]);
  const floor = getNumber(rawCollection, [
    ["floorAsk", "price", "amount", "native"],
    ["floorAskPrice"],
    ["floorSale"]
  ]);
  const topBid = getNumber(rawCollection, [
    ["topBid", "price", "amount", "native"],
    ["topBidValue"]
  ]);
  const volume1d = getNumber(rawCollection, [
    ["volume", "1day"],
    ["volume", "1d"],
    ["day1Volume"]
  ]);
  const volume7d = getNumber(rawCollection, [
    ["volume", "7day"],
    ["volume", "7d"],
    ["day7Volume"]
  ]);
  const volumeChange1d = getNumber(rawCollection, [
    ["volumeChange", "1day"],
    ["volumeChange", "1d"],
    ["day1VolumeChangePercent"]
  ]);
  const volumeChange7d = getNumber(rawCollection, [
    ["volumeChange", "7day"],
    ["volumeChange", "7d"],
    ["day7VolumeChangePercent"]
  ]);
  const floorChange1d = getNumber(rawCollection, [
    ["floorSaleChange", "1day"],
    ["floorSaleChange", "1d"],
    ["day1FloorChangePercent"]
  ]);
  const floorChange7d = getNumber(rawCollection, [
    ["floorSaleChange", "7day"],
    ["floorSaleChange", "7d"],
    ["day7FloorChangePercent"]
  ]);
  const onSaleCount = getNumber(rawCollection, [
    ["onSaleCount"],
    ["listedCount"]
  ]);

  return {
    address: rawCollection.id || collectionAddress,
    name: rawCollection.name || "Unknown collection",
    image: rawCollection.image || rawCollection.imageUrl || "",
    tokenCount,
    ownerCount,
    floor,
    topBid,
    volume1d,
    volume7d,
    volumeChange1d,
    volumeChange7d,
    floorChange1d,
    floorChange7d,
    onSaleCount
  };
}

async function fetchOwnedTokens(accountAddress, collectionAddress) {
  const url = `${getApiBaseUrl()}/users/${encodeURIComponent(accountAddress)}/tokens/v7?limit=12&sort_by=acquiredAt${collectionAddress ? `&collection=${encodeURIComponent(collectionAddress)}` : ""}`;
  const data = await fetchJson(url);

  if (!Array.isArray(data.tokens)) {
    return [];
  }

  return data.tokens
    .map((entry) => entry.token || entry)
    .filter((token) => {
      const contract = String(token.contract || token.collection?.id || "").toLowerCase();
      const normalizedCollection = collectionAddress.toLowerCase();
      return !collectionAddress || contract === normalizedCollection || contract.startsWith(`${normalizedCollection}:`);
    })
    .slice(0, 8)
    .map((token) => ({
      contract: token.contract || "",
      tokenId: token.tokenId || token.id || "",
      name: token.name || `${token.collection?.name || "NFT"} #${token.tokenId || ""}`.trim(),
      image: normalizeMediaUrl(token.image || token.imageSmall || token.media || ""),
      collectionName: token.collection?.name || "Wallet NFT",
      lastSale: getNumber(token, [
        ["lastSale", "price", "amount", "native"],
        ["lastSale", "amount", "native"]
      ])
    }));
}

async function fetchJson(url) {
  const headers = { accept: "application/json" };
  if (state.apiKey) {
    headers["x-api-key"] = state.apiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Market API request failed (${response.status}): ${body || response.statusText}`);
  }

  return response.json();
}

function buildSignals(collection) {
  const signals = [];
  const listingRatio = collection.tokenCount > 0 ? collection.onSaleCount / collection.tokenCount : 0;
  const bidSupport = collection.floor > 0 ? collection.topBid / collection.floor : 0;
  const ownerDispersion = collection.tokenCount > 0 ? collection.ownerCount / collection.tokenCount : 0;

  if (collection.floorChange1d >= 5) {
    signals.push(makeSignal("positive", "Floor momentum is positive", `${formatPercent(collection.floorChange1d)} floor change over 24h suggests buyers are pushing price higher.`));
  } else if (collection.floorChange1d <= -5) {
    signals.push(makeSignal("negative", "Floor momentum is falling", `${formatPercent(collection.floorChange1d)} floor change over 24h suggests short-term weakness.`));
  } else {
    signals.push(makeSignal("neutral", "Floor momentum is flat", "Recent floor movement is muted, so price discovery may still be forming."));
  }

  if (collection.volumeChange7d >= 15 || collection.volume1d >= collection.floor * 12) {
    signals.push(makeSignal("positive", "Trading activity is expanding", "Recent volume suggests the collection still has active market participation."));
  } else if (collection.volumeChange7d <= -20) {
    signals.push(makeSignal("negative", "Trading activity is fading", "Weak recent volume can make exits harder and prices less reliable."));
  } else {
    signals.push(makeSignal("neutral", "Volume is mixed", "Recent activity is present but not strong enough to confirm a breakout."));
  }

  if (bidSupport >= 0.8) {
    signals.push(makeSignal("positive", "Top bids are close to the floor", "Buyers are providing liquidity close to ask prices, which can reduce downside slippage."));
  } else if (collection.topBid === 0 || bidSupport < 0.45) {
    signals.push(makeSignal("negative", "Bid support is thin", "A wide gap between bids and asks usually means weaker execution quality."));
  } else {
    signals.push(makeSignal("neutral", "Bid support is acceptable", "Liquidity exists, but buyers are not aggressively stepping up yet."));
  }

  if (listingRatio > 0.22) {
    signals.push(makeSignal("negative", "Listing pressure is elevated", `${Math.round(listingRatio * 100)}% of supply appears listed, which can cap short-term upside.`));
  } else if (listingRatio > 0) {
    signals.push(makeSignal("positive", "Supply pressure looks manageable", `${Math.round(listingRatio * 100)}% of supply appears listed, which is relatively controlled.`));
  } else {
    signals.push(makeSignal("neutral", "Listing pressure is unavailable", "The provider did not return enough listing data to judge supply pressure."));
  }

  if (ownerDispersion >= 0.45) {
    signals.push(makeSignal("positive", "Ownership is distributed", "A wider owner base can make a collection more resilient to single-wallet exits."));
  } else if (ownerDispersion > 0 && ownerDispersion < 0.18) {
    signals.push(makeSignal("negative", "Ownership looks concentrated", "Heavy concentration can increase volatility if a few holders exit." ));
  } else {
    signals.push(makeSignal("neutral", "Ownership dispersion is average", "Holder distribution does not create a strong directional signal."));
  }

  return signals;
}

function buildPrediction(signals) {
  const score = signals.reduce((total, signal) => {
    if (signal.tone === "positive") {
      return total + 1;
    }
    if (signal.tone === "negative") {
      return total - 1;
    }
    return total;
  }, 0);

  if (score >= 3) {
    return {
      title: "Constructive trade setup",
      summary: "Momentum, liquidity, and supply signals lean bullish. Consider bidding, accumulating selectively, or holding for follow-through.",
      confidence: "High confidence",
      tone: "positive"
    };
  }

  if (score >= 1) {
    return {
      title: "Cautiously constructive",
      summary: "The collection shows more strength than weakness, but the setup is not one-sided. Enter smaller or wait for confirmation.",
      confidence: "Medium confidence",
      tone: "neutral"
    };
  }

  if (score <= -3) {
    return {
      title: "Defensive trade setup",
      summary: "Several signals lean bearish. Consider trimming risk, waiting for stronger bids, or avoiding fresh entries.",
      confidence: "High confidence",
      tone: "negative"
    };
  }

  return {
    title: "Mixed market picture",
    summary: "Signals conflict or are incomplete. Treat this as a watchlist setup until momentum or liquidity becomes clearer.",
    confidence: "Low confidence",
    tone: "neutral"
  };
}

function render() {
  syncWalletStatus();
  elements.activeNetwork.textContent = NETWORKS[state.network].label;
  elements.connectWalletButton.disabled = state.isLoading;
  renderCollection();
  renderPrediction();
  renderOwnedTokens();
}

function renderCollection() {
  if (!state.collection) {
    elements.collectionTitle.textContent = state.isLoading ? "Loading collection..." : "No collection loaded";
    applyPillState(elements.collectionBadge, "neutral", state.isLoading ? "Fetching market data" : "Waiting for data");
    elements.metricsGrid.innerHTML = `
      <article class="metric"><span>Floor</span><strong>--</strong></article>
      <article class="metric"><span>Top bid</span><strong>--</strong></article>
      <article class="metric"><span>24h volume</span><strong>--</strong></article>
      <article class="metric"><span>Owners</span><strong>--</strong></article>
    `;
    return;
  }

  elements.collectionTitle.textContent = state.collection.name;
  const badgeTone = state.prediction ? state.prediction.tone : "neutral";
  applyPillState(elements.collectionBadge, badgeTone, shortenAddress(state.collection.address));
  elements.metricsGrid.innerHTML = `
    <article class="metric">
      <span>Floor</span>
      <strong>${formatNative(state.collection.floor)}</strong>
    </article>
    <article class="metric">
      <span>Top bid</span>
      <strong>${formatNative(state.collection.topBid)}</strong>
    </article>
    <article class="metric">
      <span>24h volume</span>
      <strong>${formatNative(state.collection.volume1d)}</strong>
    </article>
    <article class="metric">
      <span>Owners</span>
      <strong>${formatInteger(state.collection.ownerCount)}</strong>
    </article>
    <article class="metric">
      <span>24h floor change</span>
      <strong>${formatPercent(state.collection.floorChange1d)}</strong>
    </article>
    <article class="metric">
      <span>7d volume change</span>
      <strong>${formatPercent(state.collection.volumeChange7d)}</strong>
    </article>
  `;
}

function renderPrediction() {
  if (!state.prediction) {
    elements.predictionTitle.textContent = state.isLoading ? "Scoring signals..." : "Waiting for analysis";
    applyPillState(elements.confidencePill, "neutral", state.isLoading ? "Computing confidence" : "No confidence score");
    elements.predictionSummary.textContent = "This dashboard scores floor movement, bid support, volume trend, and listing pressure.";
    elements.signalList.innerHTML = `
      <article class="signal signal-neutral">
        <strong>Signals appear here</strong>
        <p>Load a collection to generate trade guidance.</p>
      </article>
    `;
    return;
  }

  elements.predictionTitle.textContent = state.prediction.title;
  applyPillState(elements.confidencePill, state.prediction.tone, state.prediction.confidence);
  elements.predictionSummary.textContent = state.prediction.summary;
  elements.signalList.innerHTML = state.signals
    .map((signal) => `
      <article class="signal signal-${signal.tone}">
        <strong>${escapeHtml(signal.title)}</strong>
        <p>${escapeHtml(signal.body)}</p>
      </article>
    `)
    .join("");
}

function renderOwnedTokens() {
  if (!state.account) {
    elements.ownedTokens.innerHTML = `
      <article class="empty-state">
        <strong>Connect MetaMask to inspect wallet NFTs.</strong>
        <p>The collection analysis still works without a wallet connection.</p>
      </article>
    `;
    return;
  }

  if (state.isLoading) {
    elements.ownedTokens.innerHTML = `
      <article class="empty-state">
        <strong>Loading wallet NFTs...</strong>
        <p>Matching tokens for the selected network and collection will appear here.</p>
      </article>
    `;
    return;
  }

  if (!state.tokens.length) {
    elements.ownedTokens.innerHTML = `
      <article class="empty-state">
        <strong>No matching NFTs found in this wallet.</strong>
        <p>If your wallet owns tokens from the chosen collection, check the contract address and network.</p>
      </article>
    `;
    return;
  }

  elements.ownedTokens.innerHTML = state.tokens
    .map((token) => `
      <article class="token-card">
        <img src="${escapeAttribute(token.image || placeholderImage(token.name))}" alt="${escapeAttribute(token.name)}">
        <div class="token-body">
          <h3 class="token-name">${escapeHtml(token.name)}</h3>
          <p class="token-meta">${escapeHtml(token.collectionName)}</p>
          <p class="token-meta">Token #${escapeHtml(String(token.tokenId || "--"))}</p>
          <p class="token-meta">Last sale: ${formatNative(token.lastSale)}</p>
        </div>
      </article>
    `)
    .join("");
}

function syncWalletStatus() {
  elements.walletStatus.textContent = state.account ? shortenAddress(state.account) : "Not connected";
}

function applyPillState(node, tone, text) {
  node.className = `pill pill-${tone}`;
  node.textContent = text;
}

function setMessage(text, tone) {
  elements.message.className = `message message-${tone}`;
  elements.message.textContent = text;
}

function makeSignal(tone, title, body) {
  return { tone, title, body };
}

function getApiBaseUrl() {
  return NETWORKS[state.network].rpcBaseUrl;
}

function getNumber(source, candidatePaths) {
  for (const path of candidatePaths) {
    const value = getPathValue(source, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

function getPathValue(source, path) {
  return path.reduce((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return current[key];
  }, source);
}

function formatNative(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return `${trimNumber(value)} ${NETWORKS[state.network].nativeSymbol}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${trimNumber(value)}%`;
}

function formatInteger(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return Intl.NumberFormat().format(Math.round(value));
}

function trimNumber(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number(value) < 1 ? 2 : 0
  });
}

function shortenAddress(address) {
  if (!address) {
    return "--";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function placeholderImage(label) {
  return `https://placehold.co/600x600/0b1730/edf3ff?text=${encodeURIComponent(label || "NFT")}`;
}

function normalizeMediaUrl(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "object") {
    const nested = value.gateway || value.url || value.png || value.originalUrl || "";
    return normalizeMediaUrl(nested);
  }

  if (typeof value === "string" && value.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
  }

  return value;
}

function getReadableWalletError(error) {
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return "The wallet action could not be completed.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
