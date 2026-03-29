const NEWS_GRID = document.getElementById('newsGrid');
const FILTER_CONTAINER = document.getElementById('filterContainer');
const DEFAULT_IMAGE = 'https://via.placeholder.com/400x200/2a2930/ffffff?text=Crypto+News';

// API: call our backend endpoint, which fetches CryptoCompare free news API
// and applies fallback logic when category-specific feed is empty.
const NEWS_BASE_URL = '/api/market/news/';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength).trim()}...`;
}

function formatTimeAgo(unixTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - Number(unixTimestamp || 0));

    const minutes = Math.floor(diff / 60);
    const hours = Math.floor(diff / 3600);
    const days = Math.floor(diff / 86400);

    if (diff < 60) return `${diff} sec ago`;
    if (diff < 3600) return `${minutes} min ago`;
    if (diff < 86400) return `${hours} hr ago`;
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function renderLoader() {
    NEWS_GRID.innerHTML = `
        <div class="loader-container">
            <div class="loader"></div>
        </div>
    `;
}

function renderState(message, isError = false) {
    NEWS_GRID.innerHTML = `
        <div class="state-box ${isError ? 'error' : ''}">
            <h3>${isError ? 'Unable to load news' : 'No news found'}</h3>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function renderNews(articles) {
    NEWS_GRID.innerHTML = '';
    const topArticles = articles.slice(0, 18);

    topArticles.forEach((article) => {
        const title = escapeHtml(article.title || 'Untitled');
        const body = escapeHtml(truncateText(article.body || '', 240));
        const sourceName = escapeHtml(article.source_info && article.source_info.name ? article.source_info.name : 'Source');
        const image = article.imageurl || DEFAULT_IMAGE;
        const url = article.url || '#';

        const card = document.createElement('a');
        card.className = 'news-card';
        card.href = url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        card.innerHTML = `
            <img class="news-image" src="${image}" alt="${title}" onerror="this.src='${DEFAULT_IMAGE}'">
            <div class="news-content">
                <div class="news-meta">
                    <span class="news-source">${sourceName}</span>
                    <span class="news-time">${formatTimeAgo(article.published_on)}</span>
                </div>
                <h2 class="news-title">${title}</h2>
                <p class="news-body">${body}</p>
                <div class="read-more">
                    Read Full Article
                    <i class="fas fa-arrow-right"></i>
                </div>
            </div>
        `;
        NEWS_GRID.appendChild(card);
    });
}

async function fetchNews(category) {
    renderLoader();

    try {
        const query = new URLSearchParams({ category }).toString();
        const response = await fetch(`${NEWS_BASE_URL}?${query}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];

        if (!rows.length) {
            renderState('No articles were returned for this category yet.');
            return;
        }

        renderNews(rows);

        if (payload.fallback_used) {
            const note = document.createElement('div');
            note.className = 'state-box';
            note.innerHTML = '<p>Category feed was empty, showing latest available news.</p>';
            NEWS_GRID.prepend(note);
        }
    } catch (error) {
        console.error('News API error:', error);
        renderState('Please check your internet connection and try again.', true);
    }
}

function setActiveFilter(activeButton) {
    const buttons = FILTER_CONTAINER.querySelectorAll('.filter-btn');
    buttons.forEach((button) => {
        button.classList.toggle('active', button === activeButton);
    });
}

function bindFilters() {
    FILTER_CONTAINER.addEventListener('click', (event) => {
        const button = event.target.closest('.filter-btn');
        if (!button) {
            return;
        }
        setActiveFilter(button);
        fetchNews(button.dataset.category || 'ALL');
    });
}

function init() {
    bindFilters();
    fetchNews('ALL');
}

init();
