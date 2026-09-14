const DATA_URL = "data/tweets.json";
const feed = document.getElementById("feed");
const statusEl = document.getElementById("status");

let allTweets = [];
let currentColumns = null;
let renderToken = 0; // lets us cancel a stale render if a resize happens mid-render

function columnsForWidth(width) {
  if (width <= 560) return 1;
  if (width <= 980) return 2;
  if (width <= 1500) return 4;
  return 6;
}

function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function loadTweets() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
  const data = await res.json();
  // Newest first
  return [...data].sort((a, b) => b.date - a.date);
}

async function embedOne(tweetId, cell) {
  if (!tweetId || !window.twttr || !window.twttr.widgets) {
    cell.classList.add("unavailable");
    cell.textContent = "Tweet unavailable";
    return null;
  }
  try {
    // Match the embed's width to the cell's actual rendered width so
    // Twitter's own sizing logic can't make it wider than the grid
    // column (it has a hard minimum around 250px otherwise).
    const cellWidth = Math.floor(cell.getBoundingClientRect().width);
    const iframe = await window.twttr.widgets.createTweet(tweetId, cell, {
      theme: "light",
      dnt: true,
      align: "center",
      width: cellWidth > 0 ? cellWidth : undefined,
    });
    if (!iframe) {
      cell.classList.add("unavailable");
      cell.textContent = "Tweet unavailable";
      return null;
    }
    return iframe;
  } catch (err) {
    cell.classList.add("unavailable");
    cell.textContent = "Tweet unavailable";
    return null;
  }
}

async function renderRows(columns) {
  const myToken = ++renderToken;
  feed.innerHTML = "";

  if (allTweets.length === 0) {
    feed.innerHTML = `<p class="status">No tweets yet.</p>`;
    return;
  }

  const rows = chunk(allTweets, columns);

  for (const rowTweets of rows) {
    if (myToken !== renderToken) return; // a newer render superseded this one

    const rowEl = document.createElement("div");
    rowEl.className = "row";
    rowEl.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    feed.appendChild(rowEl);

    const cells = rowTweets.map(() => {
      const cell = document.createElement("div");
      cell.className = "cell";
      rowEl.appendChild(cell);
      return cell;
    });

    const iframes = await Promise.all(
      rowTweets.map((tweet, i) => embedOne(extractTweetId(tweet.url), cells[i]))
    );

    if (myToken !== renderToken) return;

    const heights = iframes
      .filter(Boolean)
      .map((iframe) => iframe.offsetHeight || iframe.scrollHeight || 0);

    const maxHeight = heights.length ? Math.max(...heights) : 300;

    cells.forEach((cell) => {
      cell.style.height = `${maxHeight}px`;
    });
  }
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const handleResize = debounce(() => {
  const cols = columnsForWidth(window.innerWidth);
  if (cols !== currentColumns) {
    currentColumns = cols;
    renderRows(cols);
  }
}, 250);

async function init() {
  try {
    allTweets = await loadTweets();
    currentColumns = columnsForWidth(window.innerWidth);
    await renderRows(currentColumns);
    window.addEventListener("resize", handleResize);
  } catch (err) {
    statusEl.textContent = "Couldn't load tweets right now.";
    console.error(err);
  }
}

// Twitter's widgets.js may still be loading when this script runs;
// twttr.ready() waits for it safely either way.
if (window.twttr && window.twttr.ready) {
  window.twttr.ready(init);
} else {
  window.addEventListener("load", init);
}
