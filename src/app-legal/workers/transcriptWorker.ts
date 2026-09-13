// @ts-nocheck
function normalizeSearch(text) {
  return String(text || '').toLowerCase();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTweetText(tweet) {
  const mentions = tweet.entities?.user_mentions || [];
  let text = tweet.full_text || '';
  if (mentions.length > 3) {
    text = text.replace(/^(@\w+\s*)+/, '').trim();
  }

  const safe = escapeHtml(text);
  return safe
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
    .replace(/@(\w+)/g, '<a href="https://twitter.com/$1" target="_blank" rel="noreferrer">@$1</a>')
    .replace(/#(\w+)/g, '<a href="https://twitter.com/hashtag/$1" target="_blank" rel="noreferrer">#$1</a>');
}

function buildMentionDisplay(tweet) {
  const keyTags = ['FBI', 'FBISanFrancisco', 'NSAOIG'];
  const mentions = tweet.entities?.user_mentions || [];
  if (mentions.length === 0) {
    return '';
  }

  let leadMention = null;
  for (const keyTag of keyTags) {
    leadMention = mentions.find((mention) => mention.screen_name === keyTag);
    if (leadMention) {
      break;
    }
  }

  if (!leadMention && mentions.length > 3) {
    leadMention = mentions[0];
  }

  if (!leadMention) {
    return '';
  }

  const extraCount = mentions.length - 1;
  return `<a href="https://twitter.com/${leadMention.screen_name}" target="_blank" rel="noreferrer">@${leadMention.screen_name}</a>${extraCount > 0 ? ` <span class="muted">and ${extraCount} others</span>` : ''}`;
}

function inSelectedDateRanges(createdAt, dateRanges) {
  if (dateRanges.length === 0) {
    return true;
  }

  const tweetDate = new Date(createdAt);
  return dateRanges.some((range) => {
    const start = new Date(range.start);
    const end = new Date(range.end);
    end.setHours(23, 59, 59, 999);
    return tweetDate >= start && tweetDate <= end;
  });
}

self.onmessage = (event) => {
  const {
    tweets,
    filters,
    searchQuery,
    currentPage,
    tweetsPerPage,
    selectedIds,
  } = event.data;

  const filteredTweets = tweets.filter((item) => {
    const tweet = item.tweet;
    const normalizedText = normalizeSearch(tweet.full_text);
    const isReply = Boolean(tweet.in_reply_to_status_id_str);

    if (filters.filterRetweets && normalizedText.startsWith('rt @')) {
      return false;
    }

    if (filters.filterNonReplyLinks && !isReply && /https?:\/\/|t\.co\/|youtu\.be|youtube\.com/i.test(tweet.full_text || '')) {
      return false;
    }

    if (filters.keywords.length > 0 && filters.keywords.some((keyword) => normalizedText.includes(normalizeSearch(keyword)))) {
      return false;
    }

    if (!inSelectedDateRanges(tweet.created_at, filters.dateRanges)) {
      return false;
    }

    return true;
  });

  const searchedTweets = searchQuery
    ? filteredTweets.filter((item) => normalizeSearch(item.tweet.full_text).includes(normalizeSearch(searchQuery)))
    : filteredTweets;

  const totalPages = Math.max(1, Math.ceil(searchedTweets.length / tweetsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * tweetsPerPage;
  const pageTweets = searchedTweets.slice(startIndex, startIndex + tweetsPerPage).map((item) => {
    const tweet = item.tweet;
    return {
      id: tweet.id_str,
      dateLabel: new Date(tweet.created_at).toLocaleString(),
      isRetweet: normalizeSearch(tweet.full_text).startsWith('rt @'),
      isReply: Boolean(tweet.in_reply_to_status_id_str),
      favoriteCount: tweet.favorite_count || 0,
      retweetCount: tweet.retweet_count || 0,
      mentionDisplay: buildMentionDisplay(tweet),
      htmlText: formatTweetText(tweet),
      rawText: tweet.full_text || '',
      selected: selectedIds.includes(tweet.id_str),
    };
  });

  self.postMessage({
    filteredIds: filteredTweets.map((item) => item.tweet.id_str),
    pageTweets,
    totalFiltered: filteredTweets.length,
    totalSearchResults: searchedTweets.length,
    totalPages,
    currentPage: safePage,
    selectedCount: selectedIds.filter((id) => filteredTweets.some((item) => item.tweet.id_str === id)).length,
  });
};
