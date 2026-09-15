const DATA_URL = "data/tweets.json";
const feed = document.getElementById("feed");
const statusEl = document.getElementById("status");

let allTweets = [];
let currentColumns = null;
let renderToken = 0; // lets us cancel stale observers/queue items if a resize happens

// A simple sequential queue: even if several rows scroll into view at once
// (fast scrolling, big monitor), we only ask Twitter for one row's worth of
// embeds at a time. This is what actually prevents the "Not found" errors
// you were seeing further down the feed — that was Twitter's embed service
// rate-limiting a burst of requests, not tweets actually being deleted.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((err) => console.error(err));
  return queue;
}

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

async function fillRow(rowEl, rowTweets, myToken) {
  if (myToken !== renderToken) return;

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

  rowEl.style.minHeight = "";
}

function buildRows(columns, myToken) {
  feed.innerHTML = "";

  if (allTweets.length === 0) {
    feed.innerHTML = `<p class="status">No tweets yet.</p>`;
    return;
  }

  const rows = chunk(allTweets, columns);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const rowEl = entry.target;
        observer.unobserve(rowEl);
        const rowTweets = JSON.parse(rowEl.dataset.tweets);
        enqueue(() => fillRow(rowEl, rowTweets, myToken));
      }
    },
    {
      // Start loading a row a bit before it actually reaches the viewport,
      // so tweets are usually already in place by the time you scroll to them.
      rootMargin: "600px 0px",
    }
  );

  for (const rowTweets of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    rowEl.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    // Placeholder height avoids a big layout jump before embeds load in.
    rowEl.style.minHeight = "300px";
    rowEl.dataset.tweets = JSON.stringify(rowTweets);
    feed.appendChild(rowEl);
    observer.observe(rowEl);
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
    const myToken = ++renderToken; // cancels any in-flight/queued row fills from the old layout
    queue = Promise.resolve();
    buildRows(cols, myToken);
  }
}, 250);

async function init() {
  try {
    allTweets = await loadTweets();
    currentColumns = columnsForWidth(window.innerWidth);
    const myToken = ++renderToken;
    buildRows(currentColumns, myToken);
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
